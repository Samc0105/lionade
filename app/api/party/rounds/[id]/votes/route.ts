// GET /api/party/rounds/[id]/votes — read the live tally for a round.
//
// Query param: ?round_kind=sketch|bluff|pokerface (required — tells us
// which round table to look the room up in)
//
// Returns { tally, total_eligible, total_voted, threshold_reached, winner }.
// Frontend polls this OR subscribes to a Realtime channel on the votes
// table for the live dot-progress UI.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isRoomMember } from "@/lib/party/room-state";
import { computeTally, isRoundKind, resolveRoundRoom } from "@/lib/party/round-votes";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const roundId = params.id;

  const roundKindParam = req.nextUrl.searchParams.get("round_kind");
  if (!isRoundKind(roundKindParam)) {
    return NextResponse.json({ error: "Invalid round_kind" }, { status: 400 });
  }

  const resolved = await resolveRoundRoom(supabaseAdmin, roundId, roundKindParam);
  if (!resolved) {
    return NextResponse.json({ error: "Round not found" }, { status: 404 });
  }
  const { roomId } = resolved;

  if (!(await isRoomMember(supabaseAdmin, roomId, userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  const tally = await computeTally(supabaseAdmin, roundId, roomId);
  return NextResponse.json({ ok: true, ...tally });
}
