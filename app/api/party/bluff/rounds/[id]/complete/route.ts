// POST /api/party/bluff/rounds/[id]/complete — advance phase / end round.
//
// Body: { action?: "advance" | "end" }   (default "advance")
//
// Behavior:
//   - "advance":
//       write  -> vote   (set vote_ends_at)
//       vote   -> reveal (compute + persist score deltas)
//       reveal -> noop   (return 200)
//   - "end": force ended_at + phase='reveal' (host fallback for stuck rounds).
//
// Only the host of the room can call this. The client also schedules an
// automatic advance once write_ends_at / vote_ends_at passes; the host's call
// is just a fallback if the client clock drifts.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { BLUFF_TRUTH_POINTS, BLUFF_FAKE_TRICK_POINTS } from "@/lib/party/scoring";

const DEFAULT_VOTE_SECONDS = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const action: "advance" | "end" = body?.action === "end" ? "end" : "advance";

  const { data: round } = await supabaseAdmin
    .from("bluff_rounds")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("host_user_id, settings")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.host_user_id !== userId) {
    return NextResponse.json({ error: "Only the host can advance phases" }, { status: 403 });
  }

  // Force-end shortcut.
  if (action === "end" || round.phase === "reveal") {
    await scoreRound(round.id);
    await supabaseAdmin
      .from("bluff_rounds")
      .update({ phase: "reveal", ended_at: new Date().toISOString() })
      .eq("id", round.id);
    return NextResponse.json({ ok: true, phase: "reveal" });
  }

  if (round.phase === "write") {
    const voteSeconds = room.settings?.vote_seconds ?? DEFAULT_VOTE_SECONDS;
    const voteEndsAt = new Date(Date.now() + voteSeconds * 1000).toISOString();
    await supabaseAdmin
      .from("bluff_rounds")
      .update({ phase: "vote", vote_ends_at: voteEndsAt })
      .eq("id", round.id);
    return NextResponse.json({ ok: true, phase: "vote", vote_ends_at: voteEndsAt });
  }

  if (round.phase === "vote") {
    await scoreRound(round.id);
    await supabaseAdmin
      .from("bluff_rounds")
      .update({ phase: "reveal", ended_at: new Date().toISOString() })
      .eq("id", round.id);
    return NextResponse.json({ ok: true, phase: "reveal" });
  }

  return NextResponse.json({ ok: true, phase: round.phase });
}

/** Compute and persist score deltas for a finished bluff round. */
async function scoreRound(roundId: string): Promise<void> {
  const { data: round } = await supabaseAdmin
    .from("bluff_rounds")
    .select("room_id, correct_answer")
    .eq("id", roundId)
    .maybeSingle();
  if (!round) return;

  const { data: answers } = await supabaseAdmin
    .from("bluff_answers")
    .select("id, user_id, is_truth")
    .eq("round_id", roundId);
  const { data: votes } = await supabaseAdmin
    .from("bluff_votes")
    .select("answer_id, voter_user_id")
    .eq("round_id", roundId);

  const answerById = new Map<string, { user_id: string; is_truth: boolean }>();
  (answers ?? []).forEach((a) => answerById.set(a.id, { user_id: a.user_id, is_truth: a.is_truth }));

  const deltas: Map<string, number> = new Map();
  (votes ?? []).forEach((v) => {
    const answer = answerById.get(v.answer_id);
    if (!answer) return;
    if (answer.is_truth) {
      // Voter picked the truth → +1000 for voter.
      deltas.set(v.voter_user_id, (deltas.get(v.voter_user_id) ?? 0) + BLUFF_TRUTH_POINTS);
    } else {
      // Voter picked a fake → +500 for the fake's author (the bluffer).
      deltas.set(answer.user_id, (deltas.get(answer.user_id) ?? 0) + BLUFF_FAKE_TRICK_POINTS);
    }
  });

  // Apply deltas to party_room_players.
  const entries = Array.from(deltas.entries());
  for (const [uid, delta] of entries) {
    if (delta === 0) continue;
    const { data: row } = await supabaseAdmin
      .from("party_room_players")
      .select("score")
      .eq("room_id", round.room_id)
      .eq("user_id", uid)
      .maybeSingle();
    if (!row) continue;
    await supabaseAdmin
      .from("party_room_players")
      .update({ score: (row.score ?? 0) + delta })
      .eq("room_id", round.room_id)
      .eq("user_id", uid);
  }
}
