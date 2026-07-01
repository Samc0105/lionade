// POST /api/streak/expire — server-authoritative expired-streak reset.
//
// Phase 2 of the profiles column guard (migration 078): the streak reset used
// to run CLIENT-SIDE (lib/hooks.resetExpiredStreak wrote profiles.streak=0 via
// the anon client). Once 078 guards `streak`/`last_activity_at`/`daily_*`, the
// browser can no longer write them, so this owns the reset server-side.
//
// What it does: if the caller's streak is genuinely expired (last_activity_at
// older than the 36h window, matching lib/hooks.isStreakExpired) AND there's a
// streak to lose, it FIRST tries to auto-consume a Streak Freeze (see below);
// if none is available it snapshots the streak into `streak_revives` (a 24h
// pay-to-revive window; the unique partial index swallows a duplicate open
// window) and zeroes the streak fields. Re-validating server-side also means a
// client can't force-reset a streak that isn't actually expired.
//
// ── Streak Freeze auto-consume (migration 083) ───────────────────────────────
// If the user has banked freezes (profiles.streak_freezes > 0), this route
// consumes ONE and PRESERVES the streak instead of resetting it: it decrements
// the counter and re-stamps last_activity_at = now, which re-opens the 36h
// window so the streak survives this lapse. The streak value itself is left
// untouched (the user keeps their N-day streak; they do NOT gain a day).
//
// IDEMPOTENCY: this route is called on EVERY page load once the streak is stale
// (Navbar effect), so a plain "if freezes > 0, consume" would burn a freeze per
// refresh. We guard on last_freeze_consumed_date: a freeze is consumed at most
// ONCE per UTC day. The consume is a conditional UPDATE
// (streak_freezes > 0 AND last_freeze_consumed_date IS DISTINCT FROM today), so
// two concurrent expiry calls can't both decrement — only the first matches.
//
// MULTI-DAY GAP RULE: one freeze covers one LAPSE (one expiry event), regardless
// of how many days the user was gone. A single continuous absence that trips the
// 36h window is one lapse -> one freeze. The streak is preserved but does not
// advance. If the user later lapses again, another freeze covers that lapse.
// This keeps the rule simple and un-exploitable: a user can never earn free
// streak DAYS from freezes, only avoid losing the streak they already had, and
// only up to STREAK_FREEZE_CAP (3) lapses per stock.
//
// FAIL SOFT: if migration 083 isn't applied, the streak_freezes select errors
// (undefined column) and we skip the freeze path entirely, falling through to
// the normal reset exactly as before.
//
// Response: { reset: boolean, previousStreak?: number, freezeUsed?: boolean }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

const EXPIRY_WINDOW_MS = 36 * 60 * 60 * 1000; // mirrors lib/hooks.isStreakExpired
const REVIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

// Postgres "column does not exist" (migration 083 not applied yet).
const UNDEFINED_COLUMN = "42703";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("streak, last_activity_at")
      .eq("id", userId)
      .maybeSingle();

    const previousStreak = profile?.streak ?? 0;
    const lastActivityAt = (profile?.last_activity_at as string | null) ?? null;

    // Nothing to reset if there's no streak.
    if (previousStreak <= 0) {
      return NextResponse.json({ reset: false });
    }

    // Re-validate expiry server-side (don't trust the client's judgment). If
    // last_activity_at is null we treat it as expired (legacy/never-stamped),
    // matching the old behavior of resetting on the client's say-so.
    const expired =
      lastActivityAt === null ||
      Date.now() > new Date(lastActivityAt).getTime() + EXPIRY_WINDOW_MS;
    if (!expired) {
      return NextResponse.json({ reset: false });
    }

    // ── Streak Freeze auto-consume (before any reset) ────────────────────────
    // Try to cover this lapse with a banked freeze. Idempotent per UTC day so
    // repeated page-load calls can't burn more than one. Fails soft if the
    // migration 083 columns don't exist yet.
    const todayUTC = new Date().toISOString().split("T")[0];
    const { data: freezeRow, error: freezeReadErr } = await supabaseAdmin
      .from("profiles")
      .select("streak_freezes, last_freeze_consumed_date")
      .eq("id", userId)
      .maybeSingle();

    if (!freezeReadErr) {
      const freezes = Math.max(0, Number(freezeRow?.streak_freezes ?? 0));
      const alreadyConsumedToday =
        (freezeRow?.last_freeze_consumed_date as string | null) === todayUTC;

      if (freezes > 0 && !alreadyConsumedToday) {
        // Conditional decrement: only the first caller whose row still has a
        // freeze AND hasn't consumed today matches. A concurrent expiry call
        // matches 0 rows and does NOT double-decrement. On success we PRESERVE
        // the streak by re-stamping last_activity_at = now (re-opens the 36h
        // window) and leaving `streak` untouched.
        const nowIso = new Date().toISOString();
        const { data: consumedRows, error: consumeErr } = await supabaseAdmin
          .from("profiles")
          .update({
            streak_freezes: freezes - 1,
            last_freeze_consumed_date: todayUTC,
            last_activity_at: nowIso,
          })
          .eq("id", userId)
          .gt("streak_freezes", 0)
          .or(`last_freeze_consumed_date.is.null,last_freeze_consumed_date.neq.${todayUTC}`)
          .select("streak_freezes");

        if (!consumeErr && (consumedRows?.length ?? 0) > 0) {
          // Freeze covered the lapse. Streak preserved; no reset, no revive.
          try {
            await supabaseAdmin.from("coin_transactions").insert({
              user_id: userId,
              amount: 0,
              type: "shop_purchase",
              description: `Streak Freeze auto-used to protect ${previousStreak}-day streak`,
            });
          } catch {
            /* non-fatal audit */
          }
          return NextResponse.json({
            reset: false,
            freezeUsed: true,
            previousStreak,
          });
        }
        // consumeErr or 0 rows -> fall through to the normal reset below.
      }
    } else if (freezeReadErr.code !== UNDEFINED_COLUMN) {
      // A real read error (not just "migration not applied") — log and still
      // fall through to the reset so a streak is never left in limbo.
      console.error("[streak/expire] freeze read:", freezeReadErr.message);
    }

    // ── No freeze available (or migration dormant) → normal reset ────────────
    // Open a revive window only if there was a meaningful streak to lose. The
    // unique partial index on (user_id) WHERE status='open' makes a duplicate
    // insert (window already open) a quiet no-op.
    if (previousStreak >= 2) {
      const expiresAt = new Date(Date.now() + REVIVE_WINDOW_MS).toISOString();
      await supabaseAdmin.from("streak_revives").insert({
        user_id: userId,
        previous_streak: previousStreak,
        expires_at: expiresAt,
        status: "open",
      });
    }

    const { error: resetErr } = await supabaseAdmin
      .from("profiles")
      .update({
        streak: 0,
        last_activity_at: null,
        daily_questions_completed: 0,
        daily_reset_date: null,
      })
      .eq("id", userId);

    if (resetErr) {
      console.error("[streak/expire]", resetErr.message);
      return NextResponse.json({ error: "Reset failed" }, { status: 500 });
    }

    return NextResponse.json({ reset: true, previousStreak });
  } catch (e) {
    console.error("[streak/expire]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
