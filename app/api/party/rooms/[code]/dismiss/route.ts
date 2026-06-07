// POST /api/party/rooms/[code]/dismiss — host (or effective host) closes the room.
//
// Sets dismissed_at + status='ended' and broadcasts ROOM_DISMISSED so every
// client navigates away. The room stays in the DB so Past Lobbies can still
// show it, but new joiners get a friendly "this room is closed" response.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { isEffectiveHost } from "@/lib/party/room-state";
import { roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";

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
    .select("id, host_user_id, dismissed_at")
    .eq("code", code)
    .maybeSingle();

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (room.dismissed_at) {
    return NextResponse.json({ ok: true, already_dismissed: true });
  }

  const allowed = await isEffectiveHost(supabaseAdmin, room.id, room.host_user_id, userId);
  if (!allowed) {
    return NextResponse.json({ error: "Only the host can close this room" }, { status: 403 });
  }

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("party_rooms")
    .update({ status: "ended", ended_at: now, dismissed_at: now })
    .eq("id", room.id);

  const ch = supabaseAdmin.channel(roomChannel(code));
  try {
    await ch.send({
      type: "broadcast",
      event: PARTY_EVENTS.ROOM_DISMISSED,
      payload: { code },
    });
  } catch (err) {
    console.warn("[party/dismiss] broadcast warn:", err);
  } finally {
    void supabaseAdmin.removeChannel(ch);
  }

  return NextResponse.json({ ok: true });
}
