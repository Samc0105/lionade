/**
 * GET /api/user/export
 *
 * Settings overhaul 2026-06-11 — Data & Usage > Download my data (GDPR-ish
 * data-portability export).
 *
 * Bundles the caller's data into a single JSON attachment:
 *   { profile (safe fields), quiz_sessions (last 100), achievements,
 *     coin_transactions (last 100), vocab_banks + vocab_words,
 *     classes + class_notes, preferences }
 *
 * Rate limit: ONE export per 24h, gated on profiles.preferences.last_export_at.
 * The gate is an ATOMIC CLAIM — we stamp last_export_at = now via a conditional
 * UPDATE filtered on the prior value BEFORE bundling, so concurrent requests with
 * the same token can't all pass a read-check-stamp sequence and each run the
 * expensive 8-table bundle. Within the window we return 429 { error, retryAfter }
 * (retryAfter = seconds until the next allowed export).
 *
 * Auth: requireAuth. Every query is scoped to auth.userId — no input id is
 * ever trusted. All reads/writes use the service-role client (consistent with
 * the rest of /app/api), so RLS is bypassed but the user_id filter is the
 * authorization boundary.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Bundle caps — keep the response/memory blob bounded for power users. Mirrors
// the last-100 cap already applied to quiz_sessions + coin_transactions. When a
// table hits its cap the bundle flags it truncated:true so the recipient knows
// the export is partial.
const VOCAB_WORDS_CAP = 5000;
const CLASS_NOTES_CAP = 1000;

// Profile columns safe to hand back to the user. Deliberately omits internal /
// moderation columns; everything here is the user's own data.
const SAFE_PROFILE_COLUMNS =
  "id, username, display_name, avatar_url, level, xp, coins, streak, max_streak, " +
  "education_level, study_goal, selected_subjects, plan, subscription_status, " +
  "profile_visibility, created_at";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // ── 24h gate (ATOMIC CLAIM) ─────────────────────────────────────────────────
  // The gate must be race-safe: concurrent requests with the same token must NOT
  // all pass a read-then-check-then-stamp sequence and each run the expensive
  // 8-table bundle. We claim the export slot UP FRONT with a single conditional
  // UPDATE, and only bundle after a successful claim.
  //
  // How the claim stays atomic with a JSONB column:
  //   1. Read the current preferences blob (also gives us last_export_at for an
  //      accurate Retry-After + lets us preserve other keys in the merge).
  //   2. If last_export_at is within 24h -> 429 immediately (cheap fast-path).
  //   3. Otherwise issue an UPDATE that stamps last_export_at = now BUT filters on
  //      the exact prior last_export_at value we just read. Postgres serializes
  //      concurrent UPDATEs to the same row; the first writer flips the value, so
  //      every racing writer's filter (keyed on the now-stale prior value) matches
  //      zero rows. PostgREST returns the affected rows via .select(); winner gets
  //      one row, losers get zero -> 429. The bundle runs ONLY for the winner.
  //
  // We merge with { ...prefs, last_export_at } (spread) which preserves every
  // other key in the preferences blob, so other preferences are never clobbered.
  const nowIso = new Date().toISOString();

  const { data: profileRow, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .single();

  if (profErr) {
    console.error("[api/user/export] preferences read", profErr.message);
    return NextResponse.json({ error: "Failed to start export" }, { status: 500 });
  }

  const priorPrefs = (profileRow?.preferences ?? {}) as Record<string, unknown>;
  const priorLastExportAt = priorPrefs.last_export_at as string | null | undefined;

  // Fast-path refusal inside the window (cheap, avoids the conditional UPDATE).
  if (priorLastExportAt) {
    const elapsed = Date.now() - new Date(priorLastExportAt).getTime();
    if (elapsed >= 0 && elapsed < TWENTY_FOUR_HOURS_MS) {
      const retryAfter = Math.ceil((TWENTY_FOUR_HOURS_MS - elapsed) / 1000);
      return NextResponse.json(
        {
          error: "You can export your data once every 24 hours. Try again later.",
          retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  // Atomic claim: stamp now, but only if last_export_at is STILL the value we
  // just read. Racing requests read the same prior value; Postgres serializes
  // the UPDATEs so only the first one's filter matches -> only it gets a row back.
  // The { ...priorPrefs, last_export_at } spread preserves all other prefs keys.
  let claimQuery = supabaseAdmin
    .from("profiles")
    .update({ preferences: { ...priorPrefs, last_export_at: nowIso } })
    .eq("id", userId);

  claimQuery =
    priorLastExportAt === undefined || priorLastExportAt === null
      ? claimQuery.is("preferences->last_export_at", null)
      : claimQuery.eq("preferences->>last_export_at", priorLastExportAt);

  const { data: claimedRows, error: claimErr } = await claimQuery.select("id");

  if (claimErr) {
    console.error("[api/user/export] claim update", claimErr.message);
    return NextResponse.json({ error: "Failed to start export" }, { status: 500 });
  }

  const claimed = Array.isArray(claimedRows) && claimedRows.length > 0;
  if (!claimed) {
    // Another concurrent request claimed the slot first. Refuse with a Retry-After
    // computed from the prior stamp when known, else the full window.
    let retryAfter = Math.ceil(TWENTY_FOUR_HOURS_MS / 1000);
    if (priorLastExportAt) {
      const elapsed = Date.now() - new Date(priorLastExportAt).getTime();
      if (elapsed >= 0 && elapsed < TWENTY_FOUR_HOURS_MS) {
        retryAfter = Math.ceil((TWENTY_FOUR_HOURS_MS - elapsed) / 1000);
      }
    }
    return NextResponse.json(
      {
        error: "You can export your data once every 24 hours. Try again later.",
        retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // Slot claimed (last_export_at now stamped = nowIso). The bundle below reflects
  // the freshly-stamped blob.
  const storedPrefs = { ...priorPrefs, last_export_at: nowIso };

  // ── Bundle ──────────────────────────────────────────────────────────────────
  // All queries user-scoped. Run in parallel; tolerate per-table failures by
  // exporting whatever loaded (an export should not 500 because one table
  // hiccuped).
  const [
    profileRes,
    quizRes,
    achievementsRes,
    coinTxRes,
    vocabBanksRes,
    vocabWordsRes,
    classesRes,
    classNotesRes,
  ] = await Promise.all([
    supabaseAdmin.from("profiles").select(SAFE_PROFILE_COLUMNS).eq("id", userId).single(),
    supabaseAdmin
      .from("quiz_sessions")
      .select("id, subject, total_questions, correct_answers, coins_earned, xp_earned, streak_bonus, completed_at")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("achievements")
      .select("achievement_key, unlocked_at")
      .eq("user_id", userId)
      .order("unlocked_at", { ascending: false }),
    supabaseAdmin
      .from("coin_transactions")
      .select("amount, type, description, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("vocab_banks")
      .select("id, name, slug, kind, source_lang, target_lang, color, icon, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("vocab_words")
      .select("id, word, translation, source_lang, target_lang, user_definition, review_count, correct_count, last_reviewed_at, next_review_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(VOCAB_WORDS_CAP),
    supabaseAdmin
      .from("classes")
      .select("id, name, short_code, professor, term, color, emoji, position, archived, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("class_notes")
      .select("id, class_id, title, body, source, pinned, ai_topics, ai_summary, archived, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(CLASS_NOTES_CAP),
  ]);

  for (const [label, res] of [
    ["profile", profileRes],
    ["quiz_sessions", quizRes],
    ["achievements", achievementsRes],
    ["coin_transactions", coinTxRes],
    ["vocab_banks", vocabBanksRes],
    ["vocab_words", vocabWordsRes],
    ["classes", classesRes],
    ["class_notes", classNotesRes],
  ] as const) {
    if (res.error) console.error(`[api/user/export] ${label}`, res.error.message);
  }

  const vocabWords = vocabWordsRes.data ?? [];
  const classNotes = classNotesRes.data ?? [];

  const bundle = {
    export_version: 1,
    exported_at: nowIso,
    profile: profileRes.data ?? null,
    quiz_sessions: quizRes.data ?? [], // last 100
    achievements: achievementsRes.data ?? [],
    coin_transactions: coinTxRes.data ?? [], // last 100
    vocab_banks: vocabBanksRes.data ?? [],
    vocab_words: vocabWords, // capped at VOCAB_WORDS_CAP
    vocab_words_truncated: vocabWords.length >= VOCAB_WORDS_CAP,
    vocab_words_cap: VOCAB_WORDS_CAP,
    classes: classesRes.data ?? [],
    class_notes: classNotes, // capped at CLASS_NOTES_CAP
    class_notes_truncated: classNotes.length >= CLASS_NOTES_CAP,
    class_notes_cap: CLASS_NOTES_CAP,
    preferences: storedPrefs,
  };

  // last_export_at was already stamped atomically when we claimed the slot above,
  // so there is no separate stamp step here (and thus no read-then-stamp race).

  const dateStamp = nowIso.slice(0, 10);
  const body = JSON.stringify(bundle, null, 2);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="lionade-export-${dateStamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
