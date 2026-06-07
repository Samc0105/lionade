// Shared room-state fetcher.
//
// One canonical query for the lobby and game shells: pull the room row plus
// the player list (joined to profiles for usernames), shape it for the client.
// Used by both /api/party/rooms/[code] and any server-side reads in route
// handlers that need to verify "is this user actually in the room?".

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PartyPlayer, PartyRoom } from "./types";

export interface ActiveRoundLite {
  id: string;
  phase: string;
  started_at: string | null;
}

export interface RoomSnapshot {
  room: PartyRoom;
  players: PartyPlayer[];
  // Bootstrap hint for a player rejoining mid-game. Only populated when the
  // room's current_game has an in-flight (ended_at IS NULL) round. Lets the
  // *View components hydrate immediately instead of sitting on a spinner
  // until the next realtime broadcast lands.
  activeRound?: ActiveRoundLite | null;
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
    .select("user_id, score, joined_at, left_at, is_ready, is_pending_round, is_spectator, selected_subjects, profiles!inner(username, equipped_username_effect)")
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
    is_pending_round: !!(p as { is_pending_round?: boolean }).is_pending_round,
    is_spectator: !!(p as { is_spectator?: boolean }).is_spectator,
    selected_subjects: Array.isArray(p.selected_subjects) ? p.selected_subjects : [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    equipped_username_effect:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Array.isArray((p as any).profiles)
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (p as any).profiles[0]?.equipped_username_effect
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (p as any).profiles?.equipped_username_effect) ?? null,
  }));

  const typedRoom = room as PartyRoom;
  let activeRound: ActiveRoundLite | null = null;
  if (typedRoom.status === "playing" && typedRoom.current_game) {
    const table =
      typedRoom.current_game === "sketch"
        ? "sketch_rounds"
        : typedRoom.current_game === "bluff"
          ? "bluff_rounds"
          : typedRoom.current_game === "pokerface"
            ? "party_pokerface_rounds"
            : null;
    if (table) {
      const { data: r } = await supabase
        .from(table)
        .select("id, phase, started_at")
        .eq("room_id", typedRoom.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (r && r.id) {
        activeRound = {
          id: r.id as string,
          // sketch_rounds has no DB phase column (phase is client-derived from
          // word/strokes); we surface "drawing" as a stable hint so rejoiners
          // land on the correct screen and the View immediately fetches the
          // word/stroke detail to hydrate the rest.
          phase: (r as { phase?: string }).phase ?? "drawing",
          started_at: (r as { started_at?: string | null }).started_at ?? null,
        };
      }
    }
  }

  return { room: typedRoom, players: shaped, activeRound };
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

/**
 * Server-side effective-host check.
 *
 * Accepts host-gated actions when the caller is either:
 *   (a) the stored host_user_id (the happy path), or
 *   (b) the longest-connected active player (joined_at ASC, left_at IS NULL),
 *       which is the same deterministic derivation the client uses to break
 *       deadlocks when the real host disconnects mid-game.
 *
 * Only this single player gets the privilege — never "any connected player."
 */
export async function isEffectiveHost(
  supabase: SupabaseClient,
  roomId: string,
  storedHostUserId: string,
  userId: string,
): Promise<boolean> {
  if (storedHostUserId === userId) return true;
  // Stored host still in the active roster? Then nobody else is effective host.
  const { data: storedActive } = await supabase
    .from("party_room_players")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", storedHostUserId)
    .is("left_at", null)
    .maybeSingle();
  if (storedActive) return false;
  // Stored host has dropped — promote the longest-connected active player.
  const { data: oldest } = await supabase
    .from("party_room_players")
    .select("user_id")
    .eq("room_id", roomId)
    .is("left_at", null)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return oldest?.user_id === userId;
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
