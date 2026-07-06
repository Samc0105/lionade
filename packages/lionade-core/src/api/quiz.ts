/**
 * Quiz API client methods.
 *
 * Typed wrappers around POST /api/save-quiz-results. Both web and iOS use
 * these via their configured createApiClient instance.
 *
 * Response shape mirrors /app/api/save-quiz-results/route.ts. The server
 * sanity-clamps client-supplied values (totalQuestions 0..100, scores 0..500)
 * so even if the client lies about reward sizes, the server enforces the cap.
 *
 * Usage:
 *   import { quizAPI } from '@lionade/core/api/quiz';
 *   const { ok, data } = await quizAPI.saveResults(apiClient, {
 *     subject: 'Math',
 *     totalQuestions: 10,
 *     correctAnswers: 8,
 *     coinsEarned: 80,
 *     xpEarned: 80,
 *     answers: [...]
 *   });
 */

import type { ApiClient, ApiResult } from "./http.js";

// ── Request shape ─────────────────────────────────────────────────────────

export interface QuizAnswerRow {
  questionId: string;
  /** Index of the selected option (0..options.length-1). */
  selected: number;
  isCorrect: boolean;
  /** Seconds left on the timer when the user answered — 0 means timed out. */
  timeLeft: number;
}

export interface SaveQuizResultsPayload {
  subject: string;
  totalQuestions: number;
  /**
   * On the v2 path (deriveReward: true) this MUST be the RAW correct count —
   * the server re-applies score_boost from the user's active boosters itself,
   * so sending a boosted count would double-count the boost.
   */
  correctAnswers: number;
  /**
   * Client-computed reward — LEGACY path only. When deriveReward is true the
   * server ignores these entirely and derives the reward itself, so v2
   * clients omit them.
   */
  coinsEarned?: number;
  xpEarned?: number;
  /** Per-question answers — optional; if omitted the server skips the user_answers insert. */
  answers?: QuizAnswerRow[];
  /**
   * Blitz Mode — 10s question timer + 2x Fangs and XP. The server reads this
   * for the `blitz_score` bounty check in save-quiz-results. Optional so
   * older clients stay compatible.
   */
  blitzMode?: boolean;
  /**
   * Idempotency key — a stable per-attempt UUID (dashed 8-4-4-4-12). A replay
   * of the same attempt (network retry, double-submit) hits the partial
   * UNIQUE (user_id, attempt_id) server-side and returns the prior result
   * without re-crediting. Optional for backward compatibility.
   */
  attemptId?: string;
  /**
   * Drives the server's reward derivation (easy 1x / medium 1.5x / hard 2x)
   * and the advanced_quiz bounty. Server defaults to "medium" when
   * missing/invalid.
   */
  difficulty?: "easy" | "medium" | "hard";
  /**
   * v2 server-authoritative reward path. When true the server IGNORES
   * coinsEarned/xpEarned, derives the reward from the validated correct
   * count + difficulty + blitz + the user's active boosters, folds
   * score_boost in itself, and consumes the reward-feeding boosters
   * (coin/xp/coin_xp multipliers + score_boost) after the session insert.
   * Clients must NOT PATCH-consume those boosters on this path.
   */
  deriveReward?: boolean;
}

// ── Response shape ────────────────────────────────────────────────────────

/**
 * Streak milestone awarded if newStreak crosses a 3 / 7 / 14 / 30 day threshold
 * AND hasn't already been claimed (idempotency check on coin_transactions).
 */
export interface StreakMilestone {
  days: number;
  bonus: number;
}

/**
 * Authoritative reward echo — v2 clients (deriveReward) reconcile their
 * optimistic display to these server numbers.
 */
export interface QuizRewardEcho {
  /** Pre-plan-multiplier BASE Fangs this quiz earned (the display value). */
  coinsEarned: number;
  /** XP credited (the plan multiplier does not apply to XP). */
  xpEarned: number;
  /**
   * Fangs ACTUALLY added to the wallet (post plan multiplier). Equals
   * coinsEarned for free users.
   */
  coinsCredited: number;
}

export interface SaveQuizResultsResponse {
  success: true;
  sessionId: string;
  /** Updated profile row — clients use this to refresh balance, streak, level. */
  profile: Record<string, unknown>;
  /** 50F awarded every 3rd quiz within 60 minutes (consecutive-quiz bonus). 0 if none. */
  bonusFangs: number;
  /** Streak milestone reward — null if no milestone was crossed this quiz. */
  streakMilestone: StreakMilestone | null;
  /** Server-derived reward — optional so pre-echo deployments stay compatible. */
  reward?: QuizRewardEcho;
}

// ── Methods ───────────────────────────────────────────────────────────────

export const quizAPI = {
  /**
   * POST /api/save-quiz-results — record a completed quiz session.
   *
   * Server clamps reward values (coinsEarned + xpEarned each capped at 500,
   * totalQuestions at 100). Returns the updated profile row plus any bonus
   * (consecutive-quiz Fangs + streak milestone) the user earned.
   */
  saveResults(
    client: ApiClient,
    payload: SaveQuizResultsPayload,
  ): Promise<ApiResult<SaveQuizResultsResponse>> {
    return client.post<SaveQuizResultsResponse>("/api/save-quiz-results", payload);
  },
} as const;
