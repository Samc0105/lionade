/**
 * Social / Friends API — list friends, pending requests, search, send request.
 *
 * - GET /api/social/friends → friends + pendingRequests + outgoingRequests
 * - GET /api/social/search?q=... → up to 10 user matches
 * - POST /api/social/friends → send a friend request by username
 *
 * Usage:
 *   const r = await socialAPI.friends(apiClient);
 *   const matches = await socialAPI.search(apiClient, 'samc');
 *   await socialAPI.sendRequest(apiClient, 'samc');
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface Friend {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  is_online: boolean;
  last_seen: string | null;
  unreadCount: number;
}

export interface PendingRequest {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  friendshipId: string;
}

export interface OutgoingRequest {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  friendshipId: string;
  sentAt: string;
}

export interface FriendsResponse {
  friends: Friend[];
  pendingRequests: PendingRequest[];
  outgoingRequests: OutgoingRequest[];
}

export interface SearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
}

export const socialAPI = {
  friends(client: ApiClient): Promise<ApiResult<FriendsResponse>> {
    return client.get<FriendsResponse>("/api/social/friends");
  },
  search(client: ApiClient, query: string): Promise<ApiResult<{ results: SearchResult[] }>> {
    return client.get<{ results: SearchResult[] }>(
      `/api/social/search?q=${encodeURIComponent(query.trim())}`,
    );
  },
  sendRequest(client: ApiClient, friendUsername: string): Promise<ApiResult<{ ok: boolean }>> {
    return client.post<{ ok: boolean }>("/api/social/friends", { friendUsername });
  },
} as const;
