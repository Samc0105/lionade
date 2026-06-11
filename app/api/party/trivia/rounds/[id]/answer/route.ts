// POST /api/party/trivia/rounds/[id]/answer — lock in an MCQ choice.
//
// Body: { choice_index: number }  (0..options.length-1)
//
// Behavior:
//   - Auth + room-member check.
//   - Reject if phase !== 'answer' or the answer deadline has passed (409).
//   - INSERT into trivia_answers (one immutable row per player — PK guards it).
//     A re-submit (PK conflict) returns idempotent { ok:true, already:true } —
//     NO takebacks: the first answer stands and is never overwritten.
//   - We do NOT compute or return correctness here (no leak). Scoring is
//     deferred entirely to the answer->reveal flip in trivia-advance.ts.
//   - Early-advance optimization: if everyone active has now answered AND
//     there's still meaningful time left, shorten answer_ends_at to "now + a
//     brief beat" via a server write so every client re-derives the shortened
//     deadline (no client race). Only ever shortens, never extends.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isRoomMember } from "@/lib/party/room-state";

// How early "everyone's in" must arrive (vs the deadline) to bother shortening,
// and how long the post-everyone beat lasts. Tuned so a near-deadline last
// answer doesn't trigger a pointless write.
const EARLY_ADVANCE_GUARD_MS = 2_000;
const EARLY_ADVANCE_BEAT_MS = 1_500;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const choiceIndex: unknown = body?.choice_index;
  if (typeof choiceIndex !== "number" || !Number.isInteger(choiceIndex)) {
    return NextResponse.json({ error: "Invalid choice" }, { status: 400 });
  }

  const { data: round } = await supabaseAdmin
    .from("trivia_rounds")
    .select("id, room_id, phase, options, answer_ends_at, started_at")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  // Membership check prevents cross-room round-id leaks polluting another game.
  if (!(await isRoomMember(supabaseAdmin, round.room_id, userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  if (round.phase !== "answer") {
    return NextResponse.json({ error: "Time's up" }, { status: 409 });
  }
  if (round.answer_ends_at && Date.now() > new Date(round.answer_ends_at).getTime()) {
    return NextResponse.json({ error: "Time's up" }, { status: 409 });
  }

  const optionCount = Array.isArray(round.options) ? round.options.length : 0;
  if (choiceIndex < 0 || choiceIndex >= optionCount) {
    return NextResponse.json({ error: "Invalid choice" }, { status: 400 });
  }

  // Insert the answer. The (round_id, user_id) PK enforces one immutable answer
  // per player — a re-submit conflicts (23505) and we treat it as idempotent
  // WITHOUT overwriting (no takebacks).
  const { error: insertErr } = await supabaseAdmin.from("trivia_answers").insert({
    round_id: round.id,
    user_id: userId,
    choice_index: choiceIndex,
    answered_at: new Date().toISOString(),
  });

  let already = false;
  if (insertErr) {
    if (insertErr.code === "23505") {
      already = true;
    } else {
      console.error("[party/trivia/answer]", insertErr.message);
      return NextResponse.json({ error: "Couldn't save answer" }, { status: 500 });
    }
  }

  // Active, non-spectator, non-pending roster — the players we expect answers
  // from this round.
  const { data: activeRoster } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id")
    .eq("room_id", round.room_id)
    .is("left_at", null)
    .eq("is_spectator", false)
    .eq("is_pending_round", false);
  const total = activeRoster?.length ?? 0;

  const { data: answerRows } = await supabaseAdmin
    .from("trivia_answers")
    .select("user_id")
    .eq("round_id", round.id);
  const answeredCount = new Set((answerRows ?? []).map((r) => r.user_id)).size;

  // Early-advance: everyone's in AND there's still meaningful time left → pull
  // the deadline in to a brief beat. Server write so all clients re-derive it.
  // Only shorten (now + beat < current deadline), never extend.
  if (
    !already &&
    total > 0 &&
    answeredCount >= total &&
    round.answer_ends_at
  ) {
    const deadlineMs = new Date(round.answer_ends_at).getTime();
    const now = Date.now();
    if (now < deadlineMs - EARLY_ADVANCE_GUARD_MS) {
      const shortened = now + EARLY_ADVANCE_BEAT_MS;
      if (shortened < deadlineMs) {
        await supabaseAdmin
          .from("trivia_rounds")
          .update({ answer_ends_at: new Date(shortened).toISOString() })
          .eq("id", round.id)
          .eq("phase", "answer");
      }
    }
  }

  return NextResponse.json({ ok: true, already, answered_count: answeredCount, total });
}
