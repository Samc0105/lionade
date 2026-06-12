// Lazy expiry for abandoned party lobbies (CEO directive 2026-06-12).
//
// THE RULE: a room still in status='lobby' that NEVER started a game
// (current_game IS NULL AND last_game IS NULL) whose most recent player join
// (or created_at, when no joins beyond the host insert) is older than
// PARTY_LOBBY_EXPIRY_MS (5 hours) is expired.
//
// Safety invariants:
//   - Rooms in status 'playing' or 'ended' are NEVER touched.
//   - Post-game lobbies (returned from end-game/rematch with last_game set)
//     are NEVER touched — the rule targets lobbies nobody ever played in.
//   - joined_at is the activity column: /join refreshes it on rejoin and the
//     DB defaults it to now() on fresh insert (migration 20260526230000), so
//     MAX(joined_at) moves forward on every join. Left players' rows keep
//     their joined_at, so a join-then-leave still counts as recent activity.
//   - expireLobby's UPDATE is guarded by .eq("status", "lobby") so a room
//     that concurrently flipped to 'playing' is never clobbered.
//
// No cron by design: expiry is enforced lazily at read/join time
// (/api/party/rooms/[code], /join) plus an exclusion filter in
// /api/party/history. Cheaper, and terminal correctness doesn't need a sweep.

import type { SupabaseClient } from "@supabase/supabase-js";

/** 5 hours, in milliseconds. */
export const PARTY_LOBBY_EXPIRY_MS = 5 * 60 * 60 * 1000;

/** User-facing copy returned with the 410 (shared by /join and snapshot). */
export const PARTY_LOBBY_EXPIRED_MESSAGE = "This lobby expired. Start a new one.";

export interface ExpirableRoomFields {
  id: string;
  status: string;
  current_game: string | null;
  last_game?: string | null;
  created_at: string;
  dismissed_at?: string | null;
}

/**
 * Pure rule check, given the room row + the room-wide most recent joined_at
 * (across ALL membership rows, including left players). Exported separately
 * so /api/party/history can apply the rule to rows it already fetched
 * without extra queries.
 */
export function isLobbyExpired(
  room: ExpirableRoomFields,
  lastJoinedAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (room.status !== "lobby") return false; // never expire playing/ended
  if (room.current_game || room.last_game) return false; // played at least once
  if (room.dismissed_at) return false; // already terminal via host dismiss
  const lastActivityMs = Math.max(
    new Date(room.created_at).getTime(),
    lastJoinedAt ? new Date(lastJoinedAt).getTime() : 0,
  );
  // Defensive: an unparseable timestamp must fail open (never expire).
  if (!Number.isFinite(lastActivityMs) || lastActivityMs <= 0) return false;
  return nowMs - lastActivityMs > PARTY_LOBBY_EXPIRY_MS;
}

/**
 * DB-backed check: fetches the room's most recent joined_at and applies the
 * rule. Early-returns without a query for any room the rule can't apply to,
 * so the hot path (playing rooms, post-game lobbies) pays nothing.
 */
export async function checkLobbyExpired(
  supabase: SupabaseClient,
  room: ExpirableRoomFields,
): Promise<boolean> {
  if (room.status !== "lobby" || room.current_game || room.last_game || room.dismissed_at) {
    return false;
  }
  const { data, error } = await supabase
    .from("party_room_players")
    .select("joined_at")
    .eq("room_id", room.id)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[party/lobby-expiry] last-join lookup", error.message);
    return false; // fail open: never expire on a read error
  }
  return isLobbyExpired(room, data?.joined_at ?? null);
}

/**
 * Lazy cleanup: flip an expired lobby to the EXISTING terminal status
 * ('ended' + ended_at — the same pair dismiss and last-player-leave already
 * write, so every client renders it identically: snapshot/join 404, history
 * "recent" bucket). dismissed_at stays NULL — that column specifically means
 * "host closed the room". The status guard makes this race-safe: a room that
 * just started playing is left alone.
 */
export async function expireLobby(supabase: SupabaseClient, roomId: string): Promise<void> {
  const { error } = await supabase
    .from("party_rooms")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", roomId)
    .eq("status", "lobby");
  if (error) {
    console.error("[party/lobby-expiry] expire update", error.message);
  }
}
