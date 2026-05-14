/**
 * Daily Missions API — 3 rotating tasks per day.
 *
 * GET /api/missions/progress returns the user's progress on today's 3
 * missions (deterministically picked from MISSION_POOL in core/constants/missions).
 * POST /api/missions/claim claims the reward for a completed mission.
 *
 * Usage:
 *   const r = await missionsAPI.progress(apiClient);
 *   await missionsAPI.claim(apiClient, missionId);
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface MissionWithProgress {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: string;
  target: number;
  coinReward: number;
  xpReward: number;
  color: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface MissionsProgressResponse {
  missions: MissionWithProgress[];
  /** Human-readable countdown to next reset (e.g. "5h 23m"). */
  resetsIn: string;
}

export interface MissionClaimResponse {
  ok: boolean;
  /** Coins awarded — falsy if the mission wasn't actually completed or was already claimed. */
  reward?: number;
}

export const missionsAPI = {
  progress(client: ApiClient): Promise<ApiResult<MissionsProgressResponse>> {
    return client.get<MissionsProgressResponse>("/api/missions/progress");
  },
  claim(
    client: ApiClient,
    missionId: string,
  ): Promise<ApiResult<MissionClaimResponse>> {
    return client.post<MissionClaimResponse>("/api/missions/claim", { missionId });
  },
} as const;
