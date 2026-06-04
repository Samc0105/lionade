// POST /api/party/rounds/[id]/vote — cast / change a post-round vote.
//
// Body: { vote_kind: "play_again" | "back_to_lobby", round_kind: "sketch" | "bluff" | "pokerface" }
//
// One vote per user per round. Recasting overwrites the prior vote via
// upsert on (round_id, user_id). Returns the live tally + threshold state
// so the caller can render the dot-progress UI without a second round trip.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isRoomMember } from "@/lib/party/room-state";
import {
  computeTally,
  isRoundKind,
  isVoteKind,
  resolveRoundRoom,
} from "@/lib/party/round-votes";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const roundId = params.id;

  const body = await req.json().catch(() => ({}));
  if (!isRoundKind(body?.round_kind)) {
    return NextResponse.json({ error: "Invalid round_kind" }, { status: 400 });
  }
  if (!isVoteKind(body?.vote_kind)) {
    return NextResponse.json({ error: "Invalid vote_kind" }, { status: 400 });
  }
  const roundKind = body.round_kind;
  const voteKind = body.vote_kind;

  const resolved = await resolveRoundRoom(supabaseAdmin, roundId, roundKind);
  if (!resolved) {
    return NextResponse.json({ error: "Round not found" }, { status: 404 });
  }
  const { roomId, roomCode } = resolved;

  if (!(await isRoomMember(supabaseAdmin, roomId, userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // Upsert by (round_id, user_id). Two key columns we care about:
  //   - voted_at refreshed so the host UI can show "X just changed their vote"
  //   - vote_kind reflects the latest choice
  const { error: upsertErr } = await supabaseAdmin
    .from("party_round_votes")
    .upsert(
      {
        round_id: roundId,
        round_kind: roundKind,
        room_code: roomCode,
        user_id: userId,
        vote_kind: voteKind,
        voted_at: new Date().toISOString(),
      },
      { onConflict: "round_id,user_id" },
    );

  if (upsertErr) {
    console.error("[party/rounds/:id/vote POST]", upsertErr.message);
    return NextResponse.json({ error: "Couldn't record vote." }, { status: 500 });
  }

  const tally = await computeTally(supabaseAdmin, roundId, roomId);
  return NextResponse.json({ ok: true, ...tally });
}
