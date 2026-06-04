// Shared room-state fetcher.
//
// One canonical query for the lobby and game shells: pull the room row plus
// the player list (joined to profiles for usernames), shape it for the client.
// Used by both /api/party/rooms/[code] and any server-side reads in route
// handlers that need to verify "is this user actually in the room?".

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PartyPlayer, PartyRoom } from "./types";

export interface RoomSnapshot {
  room: PartyRoom;
  players: PartyPlayer[];
}

export async function fetchRoomSnapshot(
  supabase: SupabaseClient,
  code: string,
): Promise<RoomSnapshot | null> {
  const { data: room, error } = await supabase
    .from("party_rooms")
    .select("*")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();

  if (error || !room) return null;

  const { data: players } = await supabase
    .from("party_room_players")
    .select("user_id, score, joined_at, left_at, is_ready, selected_subjects, profiles!inner(username, equipped_username_effect)")
    .eq("room_id", room.id)
    .is("left_at", null)
    .order("joined_at", { ascending: true });

  const shaped: PartyPlayer[] = (players ?? []).map((p) => ({
    user_id: p.user_id,
    // Supabase typed join returns the profile as either an object or array
    // depending on the relationship; we handle both shapes defensively.
    username:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Array.isArray((p as any).profiles)
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (p as any).profiles[0]?.username
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (p as any).profiles?.username) ?? null,
    score: p.score ?? 0,
    joined_at: p.joined_at,
    left_at: p.left_at,
    is_ready: !!p.is_ready,
    selected_subjects: Array.isArray(p.selected_subjects) ? p.selected_subjects : [],
  }));

  return { room: room as PartyRoom, players: shaped };
}

/** Returns true if the user is the current host of an open room. */
export async function isRoomHost(
  supabase: SupabaseClient,
  code: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("party_rooms")
    .select("host_user_id")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  return data?.host_user_id === userId;
}

/** Returns true if the user has an active membership in the room (no left_at). */
export async function isRoomMember(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("party_room_players")
    .select("user_id, left_at")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data && !data.left_at;
}
