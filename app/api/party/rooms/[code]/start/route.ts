// POST /api/party/rooms/[code]/start — host kicks off a game in the room.
//
// Body: { game: "sketch" | "bluff" | "pokerface" }
//
// Behavior:
//   - Verify the caller is the host and the room is in lobby status.
//   - Update status=playing + current_game=<game>.
//   - The actual round (sketch_rounds row or bluff_rounds row) is created by
//     the game-specific "rounds" endpoints — this route just flips the room
//     into playing mode.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";

const VALID_GAMES = new Set(["sketch", "bluff", "pokerface"]);

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
  const game: string | undefined = body?.game;
  if (!game || !VALID_GAMES.has(game)) {
    return NextResponse.json({ error: "Invalid game" }, { status: 400 });
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, host_user_id, status")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.host_user_id !== userId) {
    return NextResponse.json({ error: "Only the host can start a game" }, { status: 403 });
  }

  // Active player count + ready check.
  const { data: activePlayers } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, is_ready")
    .eq("room_id", room.id)
    .is("left_at", null);

  const playerCount = activePlayers?.length ?? 0;
  if (game === "sketch" && playerCount < 2) {
    return NextResponse.json({ error: "Sketchy Subjects needs at least 2 players" }, { status: 400 });
  }
  if (game === "bluff" && playerCount < 3) {
    return NextResponse.json({ error: "Bluff Trivia needs at least 3 players" }, { status: 400 });
  }
  // Poker Face needs at least 3 (one presenter + two callers) so a bluff has a
  // room to fool; caps at 8 like the rest of the suite.
  if (game === "pokerface" && playerCount < 3) {
    return NextResponse.json({ error: "Poker Face needs at least 3 players" }, { status: 400 });
  }

  // Every active player must be ready (host included).
  const allReady = (activePlayers ?? []).every((p) => p.is_ready);
  if (!allReady) {
    return NextResponse.json(
      { error: "Waiting for all players to ready up." },
      { status: 409 },
    );
  }

  // Reset everyone's score AND ready state for a fresh game session.
  await supabaseAdmin
    .from("party_room_players")
    .update({ score: 0, is_ready: false })
    .eq("room_id", room.id);

  await supabaseAdmin
    .from("party_rooms")
    .update({ status: "playing", current_game: game })
    .eq("id", room.id);

  return NextResponse.json({ ok: true, game, room_id: room.id });
}
