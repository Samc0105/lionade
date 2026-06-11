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
 * Within the window we return 429 { error, retryAfter } (retryAfter = seconds
 * until the next allowed export). On success we stamp last_export_at = now.
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

  // ── 24h gate ──────────────────────────────────────────────────────────────
  // Read the stored preferences blob to find last_export_at.
  const { data: profileRow, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .single();

  if (profErr) {
    console.error("[api/user/export] preferences read", profErr.message);
    return NextResponse.json({ error: "Failed to start export" }, { status: 500 });
  }

  const storedPrefs = (profileRow?.preferences ?? {}) as Record<string, unknown>;
  const lastExportAt = storedPrefs.last_export_at as string | null | undefined;

  if (lastExportAt) {
    const elapsed = Date.now() - new Date(lastExportAt).getTime();
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
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("classes")
      .select("id, name, short_code, professor, term, color, emoji, position, archived, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("class_notes")
      .select("id, class_id, title, body, source, pinned, ai_topics, ai_summary, archived, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
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

  const nowIso = new Date().toISOString();
  const bundle = {
    export_version: 1,
    exported_at: nowIso,
    profile: profileRes.data ?? null,
    quiz_sessions: quizRes.data ?? [],
    achievements: achievementsRes.data ?? [],
    coin_transactions: coinTxRes.data ?? [],
    vocab_banks: vocabBanksRes.data ?? [],
    vocab_words: vocabWordsRes.data ?? [],
    classes: classesRes.data ?? [],
    class_notes: classNotesRes.data ?? [],
    preferences: storedPrefs,
  };

  // ── Stamp last_export_at ──────────────────────────────────────────────────
  // Merge into the existing preferences blob so we never clobber other keys.
  const { error: stampErr } = await supabaseAdmin
    .from("profiles")
    .update({ preferences: { ...storedPrefs, last_export_at: nowIso } })
    .eq("id", userId);

  if (stampErr) {
    // Non-fatal for the export itself, but log it — a missed stamp would let
    // the user re-export inside the window.
    console.error("[api/user/export] stamp last_export_at", stampErr.message);
  }

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
