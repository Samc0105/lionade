// POST /api/party/bluff/rounds/[id]/vote — submit a vote for an answer.
//
// Body: { answer_id: string }
//
// Anti-cheat: a player cannot vote for their own fake answer. Re-voting
// during the vote phase replaces the prior vote. Only allowed in phase='vote'.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const answerId: string | undefined = body?.answer_id;
  if (typeof answerId !== "string") {
    return NextResponse.json({ error: "Missing answer_id" }, { status: 400 });
  }

  const { data: round } = await supabaseAdmin
    .from("bluff_rounds")
    .select("id, phase, room_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.phase !== "vote") {
    return NextResponse.json({ error: "Voting is not open" }, { status: 409 });
  }

  const { data: answer } = await supabaseAdmin
    .from("bluff_answers")
    .select("id, user_id, is_truth, round_id")
    .eq("id", answerId)
    .maybeSingle();
  if (!answer || answer.round_id !== round.id) {
    return NextResponse.json({ error: "Answer not in this round" }, { status: 400 });
  }
  if (!answer.is_truth && answer.user_id === userId) {
    return NextResponse.json({ error: "You can't vote for your own fake" }, { status: 403 });
  }

  // Upsert vote.
  await supabaseAdmin
    .from("bluff_votes")
    .upsert(
      {
        round_id: round.id,
        voter_user_id: userId,
        answer_id: answerId,
      },
      { onConflict: "round_id,voter_user_id" },
    );

  return NextResponse.json({ ok: true });
}
