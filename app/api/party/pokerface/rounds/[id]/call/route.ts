// POST /api/party/pokerface/rounds/[id]/call — a caller calls believe or doubt.
//
// Body: { call: "believe" | "doubt" }
//
// Rules:
//   - Only allowed while phase='vote'.
//   - The PRESENTER cannot call their own hand.
//   - Re-calling during the vote phase replaces the prior call (upsert).
//   - The caller must be an active member of the room.
//
// Security: the response NEVER reveals is_lie / card_fact — the caller learns
// whether they were right only at reveal (the /complete route + GET reveal phase).
// userId comes from requireAuth.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isRoomMember } from "@/lib/party/room-state";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const call = body?.call;
  if (call !== "believe" && call !== "doubt") {
    return NextResponse.json({ error: "Call must be believe or doubt" }, { status: 400 });
  }

  const { data: round } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .select("id, room_id, phase, presenter_user_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.phase !== "vote") {
    return NextResponse.json({ error: "Calling is not open" }, { status: 409 });
  }
  if (round.presenter_user_id === userId) {
    return NextResponse.json({ error: "The presenter can't call their own hand" }, { status: 403 });
  }

  const isMember = await isRoomMember(supabaseAdmin, round.room_id, userId);
  if (!isMember) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  await supabaseAdmin
    .from("party_pokerface_votes")
    .upsert(
      { round_id: round.id, voter_user_id: userId, call },
      { onConflict: "round_id,voter_user_id" },
    );

  return NextResponse.json({ ok: true });
}
