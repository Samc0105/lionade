/**
 * Bounties API — daily/weekly reward quests.
 *
 * The list of active bounties + per-user progress is currently read
 * directly from Supabase tables on the client (no /api endpoint). That
 * pattern is staying for now since it works; this module only types the
 * claim endpoint.
 *
 * Usage:
 *   await bountiesAPI.claim(apiClient, bountyId);
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface BountyClaimResponse {
  ok: boolean;
  /** Coins awarded — falsy if the bounty wasn't actually completed or already claimed. */
  reward?: number;
}

export const bountiesAPI = {
  claim(
    client: ApiClient,
    bountyId: string,
  ): Promise<ApiResult<BountyClaimResponse>> {
    return client.post<BountyClaimResponse>("/api/claim-bounty", { bountyId });
  },
} as const;
