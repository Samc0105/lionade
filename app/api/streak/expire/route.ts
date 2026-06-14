// POST /api/streak/expire — server-authoritative expired-streak reset.
//
// Phase 2 of the profiles column guard (migration 078): the streak reset used
// to run CLIENT-SIDE (lib/hooks.resetExpiredStreak wrote profiles.streak=0 via
// the anon client). Once 078 guards `streak`/`last_activity_at`/`daily_*`, the
// browser can no longer write them, so this owns the reset server-side.
//
// What it does: if the caller's streak is genuinely expired (last_activity_at
// older than the 36h window, matching lib/hooks.isStreakExpired) AND there's a
// streak to lose, it snapshots the streak into `streak_revives` (a 24h pay-to-
// revive window; the unique partial index swallows a duplicate open window) and
// zeroes the streak fields. Re-validating server-side also means a client can't
// force-reset a streak that isn't actually expired.
//
// Response: { reset: boolean, previousStreak?: number }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

const EXPIRY_WINDOW_MS = 36 * 60 * 60 * 1000; // mirrors lib/hooks.isStreakExpired
const REVIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

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
