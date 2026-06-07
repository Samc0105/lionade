// POST /api/party/rooms/[code]/join — add the authed user to a room.
//
// Idempotent: if the user is already a member with no left_at, returns the
// current snapshot. If they previously left, clears left_at and rejoins.
// Rejects rooms in status='ended' or dismissed.
//
// V2 — honors party_rooms.privacy_mode:
//   open    → join as before
//   friends → auto-join when the caller is friends-of any active member,
//             otherwise return 200 with requires_request=true so the client
//             can show the request-to-join modal.
//   closed  → return 403 with requires_request=true (until an invited list
//             lands, treat as friends-only with stricter copy).
//
// V2 — if the room is mid-round, sets is_pending_round=true so the joiner
// spectates the current round; the next ROUND_STARTED clears the flag.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { fetchRoomSnapshot } from "@/lib/party/room-state";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { setActiveSession } from "@/lib/presence";

const MAX_PLAYERS = 6;

async function isFriendOfAnyActiveMember(roomId: string, userId: string): Promise<boolean> {
  const { data: activeMembers } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id")
    .eq("room_id", roomId)
    .is("left_at", null);
  const memberIds = (activeMembers ?? []).map((m) => m.user_id).filter((id) => id !== userId);
  if (memberIds.length === 0) return false;
  const { data: friendships } = await supabaseAdmin
    .from("friendships")
    .select("user_id, friend_id, status")
    .eq("status", "accepted")
    .or(`and(user_id.eq.${userId},friend_id.in.(${memberIds.join(",")})),and(friend_id.eq.${userId},user_id.in.(${memberIds.join(",")}))`);
  return (friendships ?? []).length > 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const code = normalizeRoomCode(params.code);
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, status, host_user_id, privacy_mode, dismissed_at, current_game")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();

  if (!room || room.dismissed_at) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Count active (left_at IS NULL) players.
  const { count } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id", { count: "exact", head: true })
    .eq("room_id", room.id)
    .is("left_at", null);

  // Check if this user already has a row.
  const { data: existing } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, left_at")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing && existing.left_at === null) {
    // Refresh active_session so a re-open of the tab re-pins them to the room.
    const reJoinRole = room.host_user_id === userId ? "host" : "player";
    void setActiveSession(userId, "party_room", code, reJoinRole);
    const snap = await fetchRoomSnapshot(supabaseAdmin, code);
    return NextResponse.json({
      ok: true,
      already_member: true,
      room: snap?.room,
      players: snap?.players,
    });
  }

  if ((count ?? 0) >= MAX_PLAYERS && !existing) {
    return NextResponse.json({ error: "Room is full" }, { status: 409 });
  }

  // Privacy gate. Host bypass (host of this room creating + joining their own
  // room hits the create path; this is purely for new joiners).
  const privacy = room.privacy_mode ?? "open";
  if (privacy !== "open" && room.host_user_id !== userId) {
    const allowed = privacy === "friends" || privacy === "closed"
      ? await isFriendOfAnyActiveMember(room.id, userId)
      : true;
    if (!allowed) {
      if (privacy === "closed") {
        return NextResponse.json(
          { ok: false, requires_request: true, privacy_mode: privacy },
          { status: 200 },
        );
      }
      return NextResponse.json(
        { ok: false, requires_request: true, privacy_mode: privacy },
        { status: 200 },
      );
    }
  }

  const isMidRound = room.status === "playing" && !!room.current_game;

  if (existing) {
    // Rejoin: clear left_at, reset ready state so the host gets a fresh check.
    await supabaseAdmin
      .from("party_room_players")
      .update({
        left_at: null,
        joined_at: new Date().toISOString(),
        is_ready: false,
        is_pending_round: isMidRound,
      })
      .eq("room_id", room.id)
      .eq("user_id", userId);
  } else {
    await supabaseAdmin.from("party_room_players").insert({
      room_id: room.id,
      user_id: userId,
      score: 0,
      is_ready: false,
      is_pending_round: isMidRound,
    });
  }

  // Fire-and-forget — never block the join response on presence bookkeeping.
  const role = room.host_user_id === userId ? "host" : "player";
  void setActiveSession(userId, "party_room", code, role);

  const snap = await fetchRoomSnapshot(supabaseAdmin, code);
  return NextResponse.json({
    ok: true,
    is_pending_round: isMidRound,
    room: snap?.room,
    players: snap?.players,
  });
}
