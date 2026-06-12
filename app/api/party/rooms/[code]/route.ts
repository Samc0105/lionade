// GET /api/party/rooms/[code] — fetch a room snapshot (room + active players).
//
// Auth: requireAuth. We don't gate by membership here — any authenticated user
// can read a room they have the code for (room codes are the access control).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { fetchRoomSnapshot } from "@/lib/party/room-state";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import {
  checkLobbyExpired,
  expireLobby,
  PARTY_LOBBY_EXPIRED_MESSAGE,
} from "@/lib/party/lobby-expiry";

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const code = normalizeRoomCode(params.code);
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const snapshot = await fetchRoomSnapshot(supabaseAdmin, code);
  if (!snapshot) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // ── Lazy lobby expiry (2026-06-12) ──
  // A deep link into a never-played lobby abandoned for 5+ hours resolves to
  // the terminal state, not a live lobby. Same rule + cleanup as /join; free
  // for playing rooms and post-game lobbies (early return inside the check).
  if (await checkLobbyExpired(supabaseAdmin, snapshot.room)) {
    await expireLobby(supabaseAdmin, snapshot.room.id);
    return NextResponse.json(
      { error: PARTY_LOBBY_EXPIRED_MESSAGE, expired: true },
      { status: 410 },
    );
  }

  return NextResponse.json({
    room: snapshot.room,
    players: snapshot.players,
    meUserId: auth.userId,
    isHost: snapshot.room.host_user_id === auth.userId,
    activeRound: snapshot.activeRound ?? null,
  });
}
