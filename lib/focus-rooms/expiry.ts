// Lazy 5h expiry for abandoned Focus Room lobbies (party pattern:
// lib/party/lobby-expiry.ts). No cron by design — expiry is enforced at
// read/join time. Focus rooms are STRICTLY bounded: a lobby nobody started
// within 5 hours flips to the terminal 'expired' status.
//
// Safety invariants (mirroring the party helper):
//   - Only status='lobby' rooms are ever expired here. running/done are
//     untouchable ('running' rooms that everyone abandoned are handled by
//     the snapshot route's ends_at check, not this helper).
//   - joined_at is the activity column: /join stamps it on every fresh join,
//     so MAX(joined_at) moves forward with room activity.
//   - The UPDATE is status-guarded so a concurrently-started room wins.

import type { SupabaseClient } from "@supabase/supabase-js";

/** 5 hours, in milliseconds (same bound as party lobbies). */
export const FOCUS_ROOM_EXPIRY_MS = 5 * 60 * 60 * 1000;

export const FOCUS_ROOM_EXPIRED_MESSAGE =
  "This focus room expired. Start a fresh one.";

export interface ExpirableFocusRoomFields {
  id: string;
  status: string;
  created_at: string;
}

/** Pure rule check given the room row + most recent member joined_at. */
export function isFocusLobbyExpired(
  room: ExpirableFocusRoomFields,
  lastJoinedAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (room.status !== "lobby") return false;
  const lastActivityMs = Math.max(
    new Date(room.created_at).getTime(),
    lastJoinedAt ? new Date(lastJoinedAt).getTime() : 0,
  );
  // Defensive: unparseable timestamps fail open (never expire).
  if (!Number.isFinite(lastActivityMs) || lastActivityMs <= 0) return false;
  return nowMs - lastActivityMs > FOCUS_ROOM_EXPIRY_MS;
}

/** DB-backed check. Early-returns without a query for non-lobby rooms. */
export async function checkFocusLobbyExpired(
  supabase: SupabaseClient,
  room: ExpirableFocusRoomFields,
): Promise<boolean> {
  if (room.status !== "lobby") return false;
  const { data, error } = await supabase
    .from("focus_room_members")
    .select("joined_at")
    .eq("room_id", room.id)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[focus-rooms/expiry] last-join lookup", error.message);
    return false; // fail open: never expire on a read error
  }
  return isFocusLobbyExpired(room, data?.joined_at ?? null);
}

/** Flip an expired lobby to the terminal 'expired' status (status-guarded). */
export async function expireFocusLobby(
  supabase: SupabaseClient,
  roomId: string,
): Promise<void> {
  const { error } = await supabase
    .from("focus_rooms")
    .update({ status: "expired" })
    .eq("id", roomId)
    .eq("status", "lobby");
  if (error) {
    console.error("[focus-rooms/expiry] expire update", error.message);
  }
}
