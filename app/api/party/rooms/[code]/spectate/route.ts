// POST /api/party/rooms/[code]/spectate — toggle spectator mode for the caller.
//
// Body: { on?: boolean } — explicit if provided, toggle otherwise.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";

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

  const body = await req.json().catch(() => ({}));
  const explicit = typeof body?.on === "boolean" ? (body.on as boolean) : null;

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, status")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const { data: player } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, is_spectator")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (!player) {
    return NextResponse.json({ error: "Not in the room" }, { status: 403 });
  }

  const next = explicit !== null ? explicit : !player.is_spectator;
  await supabaseAdmin
    .from("party_room_players")
    .update({ is_spectator: next })
    .eq("room_id", room.id)
    .eq("user_id", userId);

  return NextResponse.json({ ok: true, is_spectator: next });
}
