// GET /api/party/bluff/rounds/[id] — phase-aware round snapshot.
//
// During phase='write':
//   - Returns question + category + write_ends_at. NOT the truth.
//   - Returns has_submitted flag for the requesting user.
// During phase='vote':
//   - Returns question + shuffled answers (id + text only), vote_ends_at.
//   - Hides is_truth and author until reveal.
// During phase='reveal':
//   - Returns question + correct answer + all answers with authors + per-answer
//     vote count + per-player point delta for this round.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isRoomMember } from "@/lib/party/room-state";

// Deterministic shuffle keyed by round id so the vote-phase order is stable
// across re-fetches within the same round (otherwise users would see the
// answers rearrange between polls and lose their place).
function seededShuffle<T>(arr: T[], seed: string): T[] {
  // Simple FNV-1a hash to seed mulberry32.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let s = h >>> 0;
  function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: round } = await supabaseAdmin
    .from("bluff_rounds")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  // Membership check prevents leaking reveal-phase secrets to non-members.
  if (!(await isRoomMember(supabaseAdmin, round.room_id, userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  const base = {
    id: round.id,
    room_id: round.room_id,
    round_num: round.round_num,
    question: round.question,
    category: round.category,
    phase: round.phase,
    started_at: round.started_at,
    write_ends_at: round.write_ends_at,
    vote_ends_at: round.vote_ends_at,
    ended_at: round.ended_at,
  };

  if (round.phase === "write") {
    const { data: my } = await supabaseAdmin
      .from("bluff_answers")
      .select("id, text")
      .eq("round_id", round.id)
      .eq("user_id", userId)
      .eq("is_truth", false)
      .maybeSingle();
    // Roster of player ids who have already submitted a fake. Drives the
    // live progress chip strip on the write-phase UI so the room can see
    // who's done without waiting for the next poll. Cheap query — same
    // table the count above hits.
    const { data: submittedRows } = await supabaseAdmin
      .from("bluff_answers")
      .select("user_id")
      .eq("round_id", round.id)
      .eq("is_truth", false);
    const submittedUserIds = (submittedRows ?? []).map((r) => r.user_id);
    return NextResponse.json({
      round: base,
      has_submitted: !!my,
      my_submission: my?.text ?? null,
      submitted_count: submittedUserIds.length,
      submitted_user_ids: submittedUserIds,
    });
  }

  // Vote / reveal phases: load all answers.
  const { data: answers } = await supabaseAdmin
    .from("bluff_answers")
    .select("id, text, user_id, is_truth")
    .eq("round_id", round.id);
  const list = answers ?? [];

  if (round.phase === "vote") {
    const shuffled = seededShuffle(list, round.id);
    const myVote = await supabaseAdmin
      .from("bluff_votes")
      .select("answer_id")
      .eq("round_id", round.id)
      .eq("voter_user_id", userId)
      .maybeSingle();
    return NextResponse.json({
      round: base,
      answers: shuffled.map((a) => ({ id: a.id, text: a.text })),
      my_vote_answer_id: myVote.data?.answer_id ?? null,
    });
  }

  // Reveal: include author + truth flag + vote counts + voter ids per answer
  // so the UI can render "who fell for what" chips. The party-game model
  // already accepts public-facing vote attribution at reveal.
  const { data: votes } = await supabaseAdmin
    .from("bluff_votes")
    .select("answer_id, voter_user_id")
    .eq("round_id", round.id);
  const counts: Record<string, number> = {};
  const voters: Record<string, string[]> = {};
  (votes ?? []).forEach((v) => {
    counts[v.answer_id] = (counts[v.answer_id] ?? 0) + 1;
    if (!voters[v.answer_id]) voters[v.answer_id] = [];
    voters[v.answer_id].push(v.voter_user_id);
  });

  return NextResponse.json({
    round: { ...base, correct_answer: round.correct_answer },
    answers: list.map((a) => ({
      id: a.id,
      text: a.text,
      author_user_id: a.is_truth ? null : a.user_id,
      is_truth: a.is_truth,
      vote_count: counts[a.id] ?? 0,
      voters: voters[a.id] ?? [],
    })),
  });
}
