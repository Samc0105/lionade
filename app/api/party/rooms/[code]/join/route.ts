// POST /api/party/rooms/[code]/join — add the authed user to a room.
//
// Idempotent: if the user is already a member with no left_at, returns the
// current snapshot. If they previously left, clears left_at and rejoins.
// Rejects rooms in status='ended'.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { fetchRoomSnapshot } from "@/lib/party/room-state";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { setActiveSession } from "@/lib/presence";

const MAX_PLAYERS = 6;

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
    .select("id, status, host_user_id")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();

  if (!room) {
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

  if (existing) {
    // Rejoin: clear left_at, reset ready state so the host gets a fresh check.
    await supabaseAdmin
      .from("party_room_players")
      .update({ left_at: null, joined_at: new Date().toISOString(), is_ready: false })
      .eq("room_id", room.id)
      .eq("user_id", userId);
  } else {
    await supabaseAdmin.from("party_room_players").insert({
      room_id: room.id,
      user_id: userId,
      score: 0,
      is_ready: false,
    });
  }

  // Fire-and-forget — never block the join response on presence bookkeeping.
  const role = room.host_user_id === userId ? "host" : "player";
  void setActiveSession(userId, "party_room", code, role);

  const snap = await fetchRoomSnapshot(supabaseAdmin, code);
  return NextResponse.json({
    ok: true,
    room: snap?.room,
    players: snap?.players,
  });
}
