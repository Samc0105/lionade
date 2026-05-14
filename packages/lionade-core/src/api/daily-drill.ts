/**
 * Daily Drill API — 5 questions you got wrong before.
 *
 * GET /api/daily-drill returns either the unanswered question payload or
 * a "completed today" snapshot. POST /api/daily-drill/complete submits the
 * user's correctness results and returns the awarded Fangs.
 *
 * Usage:
 *   const status = await dailyDrillAPI.status(apiClient);
 *   if (status.data && !status.data.completed) {
 *     const r = await dailyDrillAPI.submit(apiClient, results);
 *   }
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface DrillQuestion {
  id: string;
  question: string;
  options: [string, string, string, string];
  difficulty: "easy" | "medium" | "hard";
  subtopicName: string | null;
  className: string | null;
  examTitle: string | null;
  lastWrongAt: string;
}

export interface DrillStatus {
  completed: boolean;
  empty?: boolean;
  questions: DrillQuestion[];
  // Present when completed=true
  score?: number;
  total?: number;
  coinsEarned?: number;
  completedAt?: string;
}

/**
 * Per-question result. Server accepts EITHER:
 *   - `selectedIndex` (preferred) — server validates against correct_index
 *   - `wasCorrect` (legacy) — trust-the-client mode for simpler callers
 *
 * Daily Drill is low-stakes (capped Fangs reward) so the legacy path is
 * acceptable, but new code should send `selectedIndex` for integrity.
 */
export interface DrillResult {
  questionId: string;
  selectedIndex?: number;
  wasCorrect?: boolean;
}

export interface DrillCompleteResponse {
  ok: boolean;
  score: number;
  total: number;
  coinsEarned: number;
  alreadyCompleted: boolean;
  perfect?: boolean;
}

export const dailyDrillAPI = {
  status(client: ApiClient): Promise<ApiResult<DrillStatus>> {
    return client.get<DrillStatus>("/api/daily-drill");
  },
  submit(
    client: ApiClient,
    results: DrillResult[],
  ): Promise<ApiResult<DrillCompleteResponse>> {
    return client.post<DrillCompleteResponse>("/api/daily-drill/complete", { results });
  },
} as const;
