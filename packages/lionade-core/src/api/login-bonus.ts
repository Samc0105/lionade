/**
 * Daily Clock-In / Login Bonus API.
 *
 * Wraps GET /api/login-bonus (status) and POST /api/login-bonus (claim).
 * The endpoint enforces a 24h rolling cooldown and an escalating
 * consecutive-day tier that scales the awarded Fangs.
 *
 * Usage:
 *   const status = await loginBonusAPI.status(apiClient);
 *   if (status.data?.available) await loginBonusAPI.claim(apiClient);
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface ClockInStatus {
  available: boolean;
  msUntilAvailable: number;
  cooldownMs: number;
  nextAvailableAt: string | null;
  lastClaimAt: string | null;
  currentStreak: number;
  nextStreak: number;
  /** Fangs that will be awarded on the next successful claim. */
  nextAmount: number;
  lifetimeFangs: number;
  totalClaims: number;
  recent: Array<{ amount: number; claimedAt: string }>;
}

export interface ClockInClaimResponse {
  awarded: boolean;
  amount?: number;
  consecutiveDays?: number;
  reason?: string;
  msUntilAvailable?: number;
  nextAvailableAt?: string;
  lifetimeFangs?: number;
}

export const loginBonusAPI = {
  status(client: ApiClient): Promise<ApiResult<ClockInStatus>> {
    return client.get<ClockInStatus>("/api/login-bonus");
  },
  claim(client: ApiClient): Promise<ApiResult<ClockInClaimResponse>> {
    return client.post<ClockInClaimResponse>("/api/login-bonus", {});
  },
} as const;
