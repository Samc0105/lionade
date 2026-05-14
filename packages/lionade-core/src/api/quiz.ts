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
  correctAnswers: number;
  coinsEarned: number;
  xpEarned: number;
  /** Per-question answers — optional; if omitted the server skips the user_answers insert. */
  answers?: QuizAnswerRow[];
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

export interface SaveQuizResultsResponse {
  success: true;
  sessionId: string;
  /** Updated profile row — clients use this to refresh balance, streak, level. */
  profile: Record<string, unknown>;
  /** 50F awarded every 3rd quiz within 60 minutes (consecutive-quiz bonus). 0 if none. */
  bonusFangs: number;
  /** Streak milestone reward — null if no milestone was crossed this quiz. */
  streakMilestone: StreakMilestone | null;
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
