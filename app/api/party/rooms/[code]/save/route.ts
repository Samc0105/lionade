// POST /api/party/rooms/[code]/save — toggle "save room" for the calling user.
//
// V2 ships the surface (Past Lobbies has a "Saved" section) but the persistent
// saved-rooms table is deferred. Returns 204 + saved=false so the UI stays
// honest. Re-implement once party_saved_rooms exists.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const code = normalizeRoomCode(params.code);
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, saved: false, deferred: true });
}
