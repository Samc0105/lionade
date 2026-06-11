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
  // ── Sketch-only hydration fields (round-1-dead fix 2026-06-11) ──
  // SketchView adopts the newest active round from this snapshot whenever a
  // ROUND_STARTED broadcast was missed (the lobby->game transition races the
  // sketch channel subscribe). The id alone wasn't enough to land a client in
  // a live round: without the drawer the adopting client could never show the
  // picker (or fetch /words) when IT was the drawer, leaving round 1 dead.
  // These are all public round facts — the secret word itself NEVER rides
  // here, only the word_picked boolean (derived server-side).
  drawer_user_id?: string;
  round_num?: number;
  subject?: string;
  duration_sec?: number;
  word_picked?: boolean;
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
    .select("user_id, score, joined_at, left_at, is_ready, is_pending_round, is_spectator, selected_subjects, profiles!inner(username, equipped_username_effect, equipped_frame, equipped_name_color, equipped_avatar_aura)")
    .eq("room_id", room.id)
    .is("left_at", null)
    .order("joined_at", { ascending: true });

  // Supabase typed join returns the profile as either an object or array
  // depending on the relationship; read a field defensively from either shape.
  const profileField = (p: unknown, key: string): string | null => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prof = (p as any).profiles;
    const val = Array.isArray(prof) ? prof[0]?.[key] : prof?.[key];
    return (val as string | null) ?? null;
  };

  const shaped: PartyPlayer[] = (players ?? []).map((p) => ({
    user_id: p.user_id,
    username: profileField(p, "username"),
    score: p.score ?? 0,
    joined_at: p.joined_at,
    left_at: p.left_at,
    is_ready: !!p.is_ready,
    is_pending_round: !!(p as { is_pending_round?: boolean }).is_pending_round,
    is_spectator: !!(p as { is_spectator?: boolean }).is_spectator,
    selected_subjects: Array.isArray(p.selected_subjects) ? p.selected_subjects : [],
    equipped_username_effect: profileField(p, "equipped_username_effect"),
    equipped_frame: profileField(p, "equipped_frame"),
    equipped_name_color: profileField(p, "equipped_name_color"),
    equipped_avatar_aura: profileField(p, "equipped_avatar_aura"),
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
            : typedRoom.current_game === "trivia"
              ? "trivia_rounds"
              : null;
    if (table) {
      const isSketch = typedRoom.current_game === "sketch";
      // Sketch reads `word` ONLY to derive the word_picked boolean below —
      // the raw word must never be shaped into the snapshot (it would leak
      // the secret to every guesser pre-reveal).
      const { data: r } = await supabase
        .from(table)
        .select(
          // Single-literal assertion: a union of two select-string literals
          // breaks supabase-js's type-level query parser (ParserError). The
          // row is hand-cast below anyway, so no type fidelity is lost.
          (isSketch
            ? "id, phase, started_at, drawer_user_id, round_num, subject, duration_sec, word"
            : "id, phase, started_at") as "id, phase, started_at",
        )
        .eq("room_id", typedRoom.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (r && r.id) {
        activeRound = {
          id: r.id as string,
          phase: (r as { phase?: string }).phase ?? "drawing",
          started_at: (r as { started_at?: string | null }).started_at ?? null,
        };
        if (isSketch) {
          const sr = r as {
            drawer_user_id?: string;
            round_num?: number;
            subject?: string;
            duration_sec?: number;
            word?: string | null;
          };
          activeRound.drawer_user_id = sr.drawer_user_id;
          activeRound.round_num = sr.round_num;
          activeRound.subject = sr.subject;
          activeRound.duration_sec = sr.duration_sec;
          activeRound.word_picked = !!sr.word && sr.word !== "__pending__";
        }
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
 *   (b) the longest-connected active player (joined_at ASC, then user_id ASC,
 *       left_at IS NULL), which is the SAME deterministic derivation the client
 *       uses (BluffView: joined_at then user_id.localeCompare) to break
 *       deadlocks when the real host disconnects mid-game. The user_id tiebreak
 *       is load-bearing: when two players share an identical joined_at, ordering
 *       by joined_at alone let client and server elect DIFFERENT effective hosts,
 *       so the client-elected host's advance POST got 403'd and the room stalled.
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
  // Tiebreak by user_id ASC so this matches the client's sort exactly
  // (BluffView sorts joined_at then user_id.localeCompare, ascending). Without
  // the user_id tiebreak, identical joined_at timestamps let the two sides pick
  // different hosts → the client host's advance 403'd → stall.
  const { data: oldest } = await supabase
    .from("party_room_players")
    .select("user_id")
    .eq("room_id", roomId)
    .is("left_at", null)
    .order("joined_at", { ascending: true })
    .order("user_id", { ascending: true })
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
