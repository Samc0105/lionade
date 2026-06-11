/**
 * Social / Friends API — list friends, pending requests, search, send request,
 * accept/decline, cancel outgoing, activity feed + circle, nudges, DMs.
 *
 * Endpoints (all under /api/social/*, shared with the web app):
 * - GET    /api/social/friends                       → friends + pendingRequests + outgoingRequests
 * - POST   /api/social/friends  { friendUsername }   → send a friend request by username
 * - PATCH  /api/social/friends  { friendshipId, action: "accept"|"decline" }
 * - DELETE /api/social/friends?id=<friendshipId>     → cancel an outgoing pending request
 * - GET    /api/social/search?q=...                  → up to 8 matches w/ relationship
 * - GET    /api/social/feed                          → activity feed + weekly circle
 * - GET    /api/social/nudge                          → remaining/limit/nudgedToday
 * - POST   /api/social/nudge   { recipientId, preset }
 * - GET    /api/social/messages?friendId=...          → conversation + arenaEvents
 * - POST   /api/social/messages { receiverId, content }
 *
 * SCHEMA NOTE (verified against web routes 2026-06-11):
 *   - The web search route responds with `{ users: [...] }`, NOT `{ results }`.
 *     The earlier iOS core read `res.data.results` → silently empty search.
 *     Fixed here: search() returns the raw `{ users }` envelope.
 *   - Accept/decline is PATCH on /api/social/friends with body
 *     `{ friendshipId, action }`. The earlier iOS screen PATCHed
 *     /api/social/friends/<id> with `{ status }` (a route that does NOT
 *     exist on web) → accept/decline 404'd. Fixed via acceptRequest/declineRequest.
 */

import type { ApiClient, ApiResult } from "./http.js";

// Cosmetic equipped_* fields are passed through but NOT rendered on iOS until
// §8 (Shop) builds the shared frame/aura/name-color renderer. Optional so the
// types stay valid whether or not the server includes them.
export interface CosmeticFields {
  equipped_username_effect?: string | null;
  equipped_frame?: string | null;
  equipped_name_color?: string | null;
  equipped_avatar_aura?: string | null;
}

export interface Friend extends CosmeticFields {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  is_online: boolean;
  last_seen: string | null;
  unreadCount: number;
}

export interface PendingRequest extends CosmeticFields {
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

/**
 * Relationship of a search result to the searching user — drives the action
 * button (Add / Accept / Requested / Friends). `friendshipId` is non-null only
 * for incoming (Accept) / outgoing (Requested) rows.
 */
export type Relationship = "none" | "incoming" | "outgoing" | "friends";

export interface SearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  relationship: Relationship;
  friendshipId: string | null;
}

export interface FeedItem {
  id: string;
  friendId: string;
  friendUsername: string;
  friendAvatarUrl: string | null;
  type: string;
  amount: number;
  description: string | null;
  createdAt: string;
}

export interface CircleRank {
  userId: string;
  username: string;
  avatarUrl: string | null;
  coinsThisWeek: number;
  isMe: boolean;
}

export interface FeedResponse {
  feed: FeedItem[];
  circle: CircleRank[];
}

export interface NudgeBudget {
  remaining: number;
  limit: number;
  nudgedToday: string[];
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
}

export interface ArenaChatEvent {
  id: string;
  match_id: string;
  user1_id: string;
  user2_id: string;
  winner_id: string | null;
  player1_score: number;
  player2_score: number;
  wager: number;
  created_at: string;
}

export interface MessagesResponse {
  messages: DirectMessage[];
  arenaEvents: ArenaChatEvent[];
}

/** Fixed nudge presets — must match the web /api/social/nudge PRESETS keys. */
export type NudgePreset = "grind" | "gotthis" | "studyup" | "missyou";

export const socialAPI = {
  // ── Friends list / requests ──────────────────────────────────────────────
  friends(client: ApiClient): Promise<ApiResult<FriendsResponse>> {
    return client.get<FriendsResponse>("/api/social/friends");
  },
  sendRequest(client: ApiClient, friendUsername: string): Promise<ApiResult<{ success: boolean }>> {
    return client.post<{ success: boolean }>("/api/social/friends", { friendUsername });
  },
  acceptRequest(client: ApiClient, friendshipId: string): Promise<ApiResult<{ success: boolean; status: string }>> {
    return client.patch<{ success: boolean; status: string }>("/api/social/friends", {
      friendshipId,
      action: "accept",
    });
  },
  declineRequest(client: ApiClient, friendshipId: string): Promise<ApiResult<{ success: boolean; status: string }>> {
    return client.patch<{ success: boolean; status: string }>("/api/social/friends", {
      friendshipId,
      action: "decline",
    });
  },
  cancelRequest(client: ApiClient, friendshipId: string): Promise<ApiResult<{ success: boolean }>> {
    return client.delete<{ success: boolean }>(
      `/api/social/friends?id=${encodeURIComponent(friendshipId)}`,
    );
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  // Web route responds with `{ users }`. Returning the envelope verbatim so the
  // caller can read `.users` directly (the historic `.results` bug is gone).
  search(client: ApiClient, query: string): Promise<ApiResult<{ users: SearchResult[] }>> {
    return client.get<{ users: SearchResult[] }>(
      `/api/social/search?q=${encodeURIComponent(query.trim())}`,
    );
  },

  // ── Activity feed + weekly circle ───────────────────────────────────────────
  feed(client: ApiClient): Promise<ApiResult<FeedResponse>> {
    return client.get<FeedResponse>("/api/social/feed");
  },

  // ── Nudges ──────────────────────────────────────────────────────────────────
  nudgeBudget(client: ApiClient): Promise<ApiResult<NudgeBudget>> {
    return client.get<NudgeBudget>("/api/social/nudge");
  },
  sendNudge(
    client: ApiClient,
    recipientId: string,
    preset: NudgePreset,
  ): Promise<ApiResult<{ ok: boolean; remaining: number }>> {
    return client.post<{ ok: boolean; remaining: number }>("/api/social/nudge", {
      recipientId,
      preset,
    });
  },

  // ── Direct messages ───────────────────────────────────────────────────────
  messages(client: ApiClient, friendId: string): Promise<ApiResult<MessagesResponse>> {
    return client.get<MessagesResponse>(
      `/api/social/messages?friendId=${encodeURIComponent(friendId)}`,
    );
  },
  sendMessage(
    client: ApiClient,
    receiverId: string,
    content: string,
  ): Promise<ApiResult<{ message: DirectMessage }>> {
    return client.post<{ message: DirectMessage }>("/api/social/messages", {
      receiverId,
      content,
    });
  },
} as const;
