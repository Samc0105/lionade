/**
 * Streak Revive API — Snapchat-style 24h grace window after a streak break.
 *
 * Server enforces "one open window per user, no stockpile" via a unique
 * partial index, so the client just reads status + claims with a payment method.
 *
 * Usage:
 *   const status = await streakReviveAPI.status(apiClient);
 *   if (status.data?.open) await streakReviveAPI.claim(apiClient, 'fangs');
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface StreakReviveStatus {
  open: boolean;
  reviveId?: string;
  previousStreak?: number;
  openedAt?: string;
  expiresAt?: string;
  remainingMs?: number;
  costFangs: number;
  costCents: number;
  /** User's current Fangs balance — included to render "can afford" state without a separate fetch. */
  coins?: number;
}

export type StreakReviveMethod = "fangs" | "cash";

export interface StreakReviveClaimResponse {
  ok: boolean;
  restoredStreak?: number;
  /** Updated Fangs balance after the revive deduction. */
  coins?: number;
  /** Failure reason — e.g. 'insufficient_fangs' or 'window_expired'. */
  reason?: string;
  /** User-facing message — surfaceable directly in a toast. */
  message?: string;
}

export const streakReviveAPI = {
  status(client: ApiClient): Promise<ApiResult<StreakReviveStatus>> {
    return client.get<StreakReviveStatus>("/api/streak-revive");
  },
  claim(
    client: ApiClient,
    method: StreakReviveMethod,
  ): Promise<ApiResult<StreakReviveClaimResponse>> {
    return client.post<StreakReviveClaimResponse>("/api/streak-revive", { method });
  },
} as const;
