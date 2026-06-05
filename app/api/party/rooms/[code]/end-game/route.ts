// POST /api/party/rooms/[code]/end-game — return the room to lobby.
//
// Host-only. Sets status='lobby' and current_game=null. Final scores stay on
// the party_room_players rows so the lobby can show last-game results.

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

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, host_user_id, status, current_game")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.host_user_id !== userId) {
    return NextResponse.json({ error: "Only the host can end the game" }, { status: 403 });
  }

  // Close any in-flight sketch / bluff rounds.
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from("sketch_rounds")
    .update({ ended_at: nowIso })
    .eq("room_id", room.id)
    .is("ended_at", null);
  await supabaseAdmin
    .from("bluff_rounds")
    .update({ ended_at: nowIso, phase: "reveal" })
    .eq("room_id", room.id)
    .is("ended_at", null);

  // Preserve current_game as last_game so the lobby can surface a
  // "your group last played X" breadcrumb + auto-suggest a different
  // next game. If nothing was active (e.g. host bailed pre-game), skip
  // the write so we don't clobber an older valid breadcrumb.
  const update: { status: string; current_game: null; last_game?: string } = {
    status: "lobby",
    current_game: null,
  };
  if (room.current_game) update.last_game = room.current_game;

  await supabaseAdmin
    .from("party_rooms")
    .update(update)
    .eq("id", room.id);

  return NextResponse.json({ ok: true });
}
