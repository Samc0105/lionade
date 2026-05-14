/**
 * Daily Bet API — wager Fangs on quiz performance for the day.
 *
 * POST /api/place-bet stakes Fangs against hitting a target quiz score
 * (must be 7/8/9/10 out of 10). Bet resolves automatically when the next
 * qualifying quiz completes.
 *
 * The list of active + last-resolved bets is currently read directly from
 * the `daily_bets` Supabase table on the client — no /api endpoint there.
 *
 * Usage:
 *   await betsAPI.place(apiClient, { coinsStaked: 100, targetScore: 8 });
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface PlaceBetPayload {
  /** Fangs to stake. Server clamps to 1..10000. */
  coinsStaked: number;
  /** Must be 7, 8, 9, or 10 — server validates. */
  targetScore: number;
  /** Total questions for the target (defaults to 10 if omitted). */
  targetTotal?: number;
}

export interface PlaceBetResponse {
  success: true;
  bet: {
    id: string;
    coins_staked: number;
    target_score: number;
    target_total: number;
    subject: string | null;
    won: boolean | null;
    coins_won: number;
    resolved_at: string | null;
  };
}

export const betsAPI = {
  place(
    client: ApiClient,
    payload: PlaceBetPayload,
  ): Promise<ApiResult<PlaceBetResponse>> {
    return client.post<PlaceBetResponse>("/api/place-bet", payload);
  },
} as const;
