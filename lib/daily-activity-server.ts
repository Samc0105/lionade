/**
 * Server-side daily-activity + streak recorder (Phase 2 of migration 078).
 *
 * This is the supabaseAdmin port of lib/db.upsertDailyActivity, which used to
 * run CLIENT-SIDE (the Learning Paths flow called it via saveQuizSession and it
 * wrote profiles.streak from the browser). Once 078 guards streak/last_activity
 * /daily_* against client writes, that move has to happen server-side.
 *
 * Behavior is preserved exactly from the old client version:
 *  - Upserts today's `daily_activity` row (questions + coins counters).
 *  - The streak only ticks on the FIRST activity of the UTC day (when the row
 *    is created). Gap rules mirror the original (and save-quiz-results): a gap
 *    of 20h..48h since last_activity_at increments; > 48h resets to 1; < 20h is
 *    the same study window (no change). No shield here (the rich shield path
 *    lives in save-quiz-results; Learning Paths always used this simpler one).
 *
 * Best-effort: errors are logged, never thrown — a streak hiccup must not fail
 * the calling route's primary response.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const MIN_GAP_TO_INCREMENT_MS = 20 * 60 * 60 * 1000;
const MAX_GAP_TO_CONTINUE_MS = 48 * 60 * 60 * 1000;

export async function recordDailyActivity(
  admin: SupabaseClient,
  userId: string,
  questionsAnswered: number,
  coinsEarned = 0,
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  const { data: existing, error: fetchErr } = await admin
    .from("daily_activity")
    .select("*")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (fetchErr) {
    console.error("[recordDailyActivity] fetch:", fetchErr.message);
    return;
  }

  if (existing) {
    // Already active today — bump counters only; the streak does NOT re-tick.
    const { error: updateErr } = await admin
      .from("daily_activity")
      .update({
        questions_answered: existing.questions_answered + questionsAnswered,
        coins_earned: existing.coins_earned + coinsEarned,
        streak_maintained: true,
      })
      .eq("id", existing.id);
    if (updateErr) console.error("[recordDailyActivity] update:", updateErr.message);
    return;
  }

  // First activity of the day — create the row, then tick the streak.
  const { error: insertErr } = await admin.from("daily_activity").insert({
    user_id: userId,
    date: today,
    questions_answered: questionsAnswered,
    coins_earned: coinsEarned,
    streak_maintained: true,
  });
  if (insertErr) {
    console.error("[recordDailyActivity] insert:", insertErr.message);
    return;
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("streak, max_streak, last_activity_at")
    .eq("id", userId)
    .single();

  if (!profile) return;

  const lastActivityAt = (profile as { last_activity_at: string | null }).last_activity_at;
  let newStreak = profile.streak ?? 0;
  if (!lastActivityAt) {
    newStreak = newStreak > 0 ? newStreak : 1;
  } else {
    const gapMs = Date.now() - new Date(lastActivityAt).getTime();
    if (gapMs < MIN_GAP_TO_INCREMENT_MS) {
      // Same study window — no change.
    } else if (gapMs <= MAX_GAP_TO_CONTINUE_MS) {
      newStreak = (profile.streak ?? 0) + 1;
    } else {
      newStreak = 1;
    }
  }
  const newMax = Math.max(newStreak, profile.max_streak ?? 0);

  const { error: streakErr } = await admin
    .from("profiles")
    .update({
      streak: newStreak,
      max_streak: newMax,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (streakErr) console.error("[recordDailyActivity] streak:", streakErr.message);
}
