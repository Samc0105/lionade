// POST /api/party/rooms/[code]/join-requests/[id]/decide — host decides on a request.
//
// Body: { decision: "approve" | "decline" }
//
// On approve:
//   - Insert party_room_players row (or clear left_at if rejoining).
//   - If room is mid-round, set is_pending_round = true so the joiner spectates
//     until the next ROUND_STARTED clears the flag.
//   - Broadcast JOIN_DECISION with decision='approved' so the requester's
//     polling modal flips and they navigate into the room.
// On decline:
//   - Update status='declined' and broadcast JOIN_DECISION with decision='declined'.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { isEffectiveHost } from "@/lib/party/room-state";
import { roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";

const MAX_PLAYERS = 6;

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string; id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const code = normalizeRoomCode(params.code);
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "decline") {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, host_user_id, status, current_game")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const allowed = await isEffectiveHost(supabaseAdmin, room.id, room.host_user_id, userId);
  if (!allowed) {
    return NextResponse.json({ error: "Only the host can decide" }, { status: 403 });
  }

  const { data: request } = await supabaseAdmin
    .from("party_join_requests")
    .select("id, requester_user_id, status, room_code")
    .eq("id", params.id)
    .maybeSingle();
  if (!request || request.room_code !== code) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (request.status !== "pending") {
    return NextResponse.json({ ok: true, already_decided: true, status: request.status });
  }

  const requesterId = request.requester_user_id;
  const now = new Date().toISOString();

  if (decision === "decline") {
    await supabaseAdmin
      .from("party_join_requests")
      .update({ status: "declined", decided_at: now, decided_by: userId })
      .eq("id", request.id);

    const ch = supabaseAdmin.channel(roomChannel(code));
    try {
      await ch.send({
        type: "broadcast",
        event: PARTY_EVENTS.JOIN_DECISION,
        payload: { request_id: request.id, requester_user_id: requesterId, decision: "declined" },
      });
    } catch (err) {
      console.warn("[party/decide] broadcast warn:", err);
    } finally {
      void supabaseAdmin.removeChannel(ch);
    }
    return NextResponse.json({ ok: true, decision: "declined" });
  }

  // Approve path: capacity check, then insert/rejoin.
  const { count: activeCount } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id", { count: "exact", head: true })
    .eq("room_id", room.id)
    .is("left_at", null);

  if ((activeCount ?? 0) >= MAX_PLAYERS) {
    return NextResponse.json({ error: "Room is full" }, { status: 409 });
  }

  const { data: existing } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, left_at")
    .eq("room_id", room.id)
    .eq("user_id", requesterId)
    .maybeSingle();

  const isMidRound = room.status === "playing" && !!room.current_game;

  if (existing) {
    await supabaseAdmin
      .from("party_room_players")
      .update({
        left_at: null,
        joined_at: now,
        is_ready: false,
        is_pending_round: isMidRound,
      })
      .eq("room_id", room.id)
      .eq("user_id", requesterId);
  } else {
    await supabaseAdmin.from("party_room_players").insert({
      room_id: room.id,
      user_id: requesterId,
      score: 0,
      is_ready: false,
      is_pending_round: isMidRound,
    });
  }

  await supabaseAdmin
    .from("party_join_requests")
    .update({ status: "approved", decided_at: now, decided_by: userId })
    .eq("id", request.id);

  const ch = supabaseAdmin.channel(roomChannel(code));
  try {
    await ch.send({
      type: "broadcast",
      event: PARTY_EVENTS.JOIN_DECISION,
      payload: {
        request_id: request.id,
        requester_user_id: requesterId,
        decision: "approved",
        is_pending_round: isMidRound,
      },
    });
  } catch (err) {
    console.warn("[party/decide] broadcast warn:", err);
  } finally {
    void supabaseAdmin.removeChannel(ch);
  }

  return NextResponse.json({ ok: true, decision: "approved", is_pending_round: isMidRound });
}
