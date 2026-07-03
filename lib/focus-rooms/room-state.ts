// Shared Focus Room snapshot fetcher (party room-state pattern).
//
// One canonical query for the lobby/running/done shells: the room row plus
// the member list joined to profiles for usernames/avatars. Members are
// returned INCLUDING those who left (left_at set) so the done summary can
// show who bailed; live views filter on left_at === null client-side.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FocusRoomPrivacy, FocusRoomStatus } from "./constants";

export interface FocusRoomRow {
  id: string;
  code: string;
  host_user_id: string;
  privacy_mode: FocusRoomPrivacy;
  duration_minutes: number;
  status: FocusRoomStatus;
  started_at: string | null;
  ends_at: string | null;
  created_at: string;
}

export interface FocusRoomMember {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  joined_at: string;
  left_at: string | null;
  completed: boolean;
  bonus_granted: boolean;
}

export interface FocusRoomSnapshot {
  room: FocusRoomRow;
  members: FocusRoomMember[];
}

/**
 * Most-recent room for a code (codes recycle once a room is done/expired,
 * party pattern), or null. The caller decides how to treat terminal states.
 * Throws NOTHING: Postgrest errors surface via the { error } return.
 */
export async function fetchFocusRoomSnapshot(
  supabase: SupabaseClient,
  code: string,
): Promise<{ snapshot: FocusRoomSnapshot | null; error: unknown }> {
  const { data: rooms, error: roomErr } = await supabase
    .from("focus_rooms")
    .select("id, code, host_user_id, privacy_mode, duration_minutes, status, started_at, ends_at, created_at")
    .eq("code", code)
    .order("created_at", { ascending: false })
    .limit(1);
  if (roomErr) return { snapshot: null, error: roomErr };
  const room = rooms?.[0] as FocusRoomRow | undefined;
  if (!room) return { snapshot: null, error: null };

  const { data: members, error: memberErr } = await supabase
    .from("focus_room_members")
    .select("user_id, joined_at, left_at, completed, bonus_granted, profiles!inner(username, avatar_url)")
    .eq("room_id", room.id)
    .order("joined_at", { ascending: true });
  if (memberErr) return { snapshot: null, error: memberErr };

  // Supabase typed join returns the profile as object or array depending on
  // the relationship; read defensively from either shape (party pattern).
  const profileField = (p: unknown, key: string): string | null => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prof = (p as any).profiles;
    const val = Array.isArray(prof) ? prof[0]?.[key] : prof?.[key];
    return (val as string | null) ?? null;
  };

  const shaped: FocusRoomMember[] = (members ?? []).map((m) => ({
    user_id: m.user_id,
    username: profileField(m, "username"),
    avatar_url: profileField(m, "avatar_url"),
    joined_at: m.joined_at,
    left_at: m.left_at,
    completed: !!m.completed,
    bonus_granted: !!m.bonus_granted,
  }));

  return { snapshot: { room, members: shaped }, error: null };
}
