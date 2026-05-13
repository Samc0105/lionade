/**
 * Daily Spin API client methods.
 *
 * Typed wrappers around POST /api/spin/roll and GET /api/spin/status.
 * Both web and iOS use these via the createApiClient instance configured
 * in their respective lib/api-client.ts.
 *
 * Response shapes mirror the actual server contract in
 * /app/api/spin/{status,roll}/route.ts — if those routes change, update
 * these interfaces in lockstep.
 *
 * Usage:
 *   import { spinAPI } from '@lionade/core/api/spin';
 *   const status = await spinAPI.status(apiClient);
 *   if (status.data?.canSpin) {
 *     const result = await spinAPI.roll(apiClient);
 *   }
 */

import type { ApiClient, ApiResult } from "./http.js";
import type { SpinOutcome } from "../logic/spin-rng.js";

// ── Response shapes (match what /app/api/spin/* routes return) ────────────

export interface SpinStatus {
  canSpin: boolean;
  lastSpinAt: string | null;        // ISO timestamp, null if never spun
  nextSpinAt: string | null;        // ISO timestamp, null if available now
  cooldownMs: number;
  lastOutcome: {
    outcome: string;                // SpinOutcome string, but DB has historical values so widened
    fangsDelta: number;
  } | null;
}

export interface SpinRollResult {
  outcome: SpinOutcome;
  /** Index into SPIN_SLOTS — drives wheel landing animation on the client. */
  slotIndex: number;
  /** Actual Fangs change after balance clamping (e.g. bust never goes negative). */
  fangsDelta: number;
  /** Pre-clamp delta — lets the UI show an honest "you only had X" message. */
  intendedDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  rewardPayload: Record<string, unknown> | null;
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
