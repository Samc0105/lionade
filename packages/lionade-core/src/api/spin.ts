/**
 * Daily Spin API client methods.
 *
 * Typed wrappers around POST /api/spin/roll and GET /api/spin/status.
 * Both web and iOS use these via the createApiClient instance configured
 * in their respective lib/api-client.ts.
 *
 * Usage:
 *   import { spinAPI } from '@lionade/core/api/spin';
 *   const { ok, data } = await spinAPI.roll(apiClient);
 */

import type { ApiClient, ApiResult } from "./http.js";
import type { SpinOutcome } from "../logic/spin-rng.js";

// ── Response shapes (mirror what /app/api/spin/* routes return) ───────────

export interface SpinStatus {
  canSpin: boolean;
  nextSpinAt: string | null;        // ISO timestamp, null if available now
  lastSpunAt: string | null;
  /** Streak of consecutive daily spins — drives badge unlocks. */
  spinStreak: number;
}

export interface SpinRollResult {
  outcome: SpinOutcome;
  slotIndex: number;                // 0..9 — for client-side animation targeting
  fangsDelta: number;               // signed; can be negative (bust, tax_man)
  newBalance: number;               // balance AFTER the delta is applied
  rewardPayload: {
    kind: string;
    [k: string]: unknown;
  } | null;
}

// ── Methods ───────────────────────────────────────────────────────────────

export const spinAPI = {
  /** GET /api/spin/status — has the user spun in the last 24h, and if so when can they spin again? */
  status(client: ApiClient): Promise<ApiResult<SpinStatus>> {
    return client.get<SpinStatus>("/api/spin/status");
  },

  /** POST /api/spin/roll — the actual spin. Server-rolls, applies delta, returns outcome. */
  roll(client: ApiClient): Promise<ApiResult<SpinRollResult>> {
    return client.post<SpinRollResult>("/api/spin/roll");
  },
} as const;
