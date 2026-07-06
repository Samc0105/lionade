// Badge awarding — server-side only.
//
// The badges/user_badges tables (migration 20260706120000_badges_backend) are
// READ by both web (lib/db.ts getAllBadges/getUserBadges -> /badges, /profile)
// and iOS (lib/hooks/use-badges.ts, realtime INSERT channel on user_badges).
// Without a server-side writer the earned count stays 0 forever — this helper
// is that writer. Every award call site runs on supabaseAdmin (service role).
//
// Design rules (mirrors lib/cosmetic-grants.ts):
//   * FAIL-SOFT: a badge is a bonus on top of an already-successful primary
//     action (quiz save, friend accept, publish). awardBadges must never throw
//     or block the calling route — it logs and moves on.
//   * IDEMPOTENT: UNIQUE(user_id, badge_id) + ignoreDuplicates upsert means
//     calling it on every quiz save with the same context is safe and cheap.
//   * The badge ids + thresholds here mirror the seed catalog in
//     supabase/migrations/20260706120000_badges_backend.sql EXACTLY — the two
//     must move together.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface BadgeTriggerContext {
  /** Lifetime completed quiz count (first_quiz / quizzes_10 / quizzes_50). */
  totalQuizzes?: number;
  /** True when THIS quiz was a clean 10/10 (perfect_quiz). */
  perfectQuiz?: boolean;
  /** Current streak in days (streak_3 / streak_7 / streak_30). */
  streak?: number;
  /** Current Fang balance (fangs_1000). */
  fangs?: number;
  /** True when the user just gained an accepted friendship (first_friend). */
  firstFriend?: boolean;
  /** True when the user just published a study set (first_study_set). */
  firstStudySet?: boolean;
  /** True when the user just banked a TechHub shift clear (first_shift). */
  firstShift?: boolean;
  /** Lifetime Word Bank word count (wordbank_starter at 10). */
  wordbankWords?: number;
}

/** Pure mapping from a trigger context to the badge ids it satisfies. */
export function badgesFor(ctx: BadgeTriggerContext): string[] {
  const ids: string[] = [];
  const quizzes = ctx.totalQuizzes ?? 0;
  if (quizzes >= 1) ids.push("first_quiz");
  if (quizzes >= 10) ids.push("quizzes_10");
  if (quizzes >= 50) ids.push("quizzes_50");
  if (ctx.perfectQuiz) ids.push("perfect_quiz");
  const streak = ctx.streak ?? 0;
  if (streak >= 3) ids.push("streak_3");
  if (streak >= 7) ids.push("streak_7");
  if (streak >= 30) ids.push("streak_30");
  if ((ctx.fangs ?? 0) >= 1000) ids.push("fangs_1000");
  if (ctx.firstFriend) ids.push("first_friend");
  if (ctx.firstStudySet) ids.push("first_study_set");
  if (ctx.firstShift) ids.push("first_shift");
  if ((ctx.wordbankWords ?? 0) >= 10) ids.push("wordbank_starter");
  return ids;
}

/**
 * Award every badge the context satisfies. One upsert, already-earned rows
 * are silently skipped (ignoreDuplicates on UNIQUE(user_id, badge_id)), and
 * new rows fan out to clients via the user_badges realtime INSERT channel.
 */
export async function awardBadges(
  admin: SupabaseClient,
  userId: string,
  ctx: BadgeTriggerContext,
): Promise<void> {
  const ids = badgesFor(ctx);
  if (ids.length === 0) return;

  try {
    const rows = ids.map((badgeId) => ({ user_id: userId, badge_id: badgeId }));
    const { error } = await admin
      .from("user_badges")
      .upsert(rows, { onConflict: "user_id,badge_id", ignoreDuplicates: true });
    // 42P01 (missing table) = the badges migration hasn't been applied yet.
    // Expected fail-soft state — stay quiet so we don't spam every quiz save.
    if (error && error.code !== "42P01") {
      console.warn("[badges] award failed (non-fatal):", error.message);
    }
  } catch (err) {
    console.warn("[badges] award threw (non-fatal):", err);
  }
}
