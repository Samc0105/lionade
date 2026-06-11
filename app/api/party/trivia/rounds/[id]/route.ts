// GET /api/party/trivia/rounds/[id] — phase-aware round snapshot + lazy advance.
//
// During phase='answer':
//   - Returns question + category + 4 options (id + text). NEVER correct_index.
//   - Returns the caller's own locked-in choice + the answered-player roster.
// During phase='reveal':
//   - Adds correct_option_id, per-option tallies, per-player round points, and
//     a per-player scoring breakdown (base / speed / streak / correct).
//
// LAZY ADVANCE: phase advance is otherwise client-driven, so a backgrounded
// host's throttled timer would freeze the room. On every read, if the current
// phase's deadline has passed, advance ONE step inline using the SAME
// CAS-guarded, single-scoring helper the complete route uses, then re-read.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isRoomMember } from "@/lib/party/room-state";
import {
  advanceTriviaPhase,
  publicOptions,
  loadPriorStreak,
  computeTriviaBreakdown,
  triviaWindowMs,
} from "@/lib/party/trivia-advance";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let { data: round } = await supabaseAdmin
    .from("trivia_rounds")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  // Membership check prevents leaking reveal-phase secrets to non-members.
  if (!(await isRoomMember(supabaseAdmin, round.room_id, userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // ── Server-side lazy advance (self-heal) ──
  // If the current phase's deadline has passed, advance one step inline via the
  // CAS-guarded helper (UPDATE ... WHERE phase=<from>), then re-read. Even if
  // this GET races a client complete POST, exactly one flips + scores.
  if (round.ended_at == null) {
    const deadline =
      round.phase === "answer"
        ? round.answer_ends_at
        : round.phase === "reveal"
          ? round.reveal_ends_at
          : null;
    if (deadline && Date.now() > new Date(deadline).getTime()) {
      const { data: room } = await supabaseAdmin
        .from("party_rooms")
        .select("settings")
        .eq("id", round.room_id)
        .maybeSingle();
      await advanceTriviaPhase(
        supabaseAdmin,
        round.id,
        round.phase as "answer" | "reveal",
        room?.settings?.trivia_reveal_seconds,
      );
      const { data: fresh } = await supabaseAdmin
        .from("trivia_rounds")
        .select("*")
        .eq("id", params.id)
        .maybeSingle();
      if (fresh) round = fresh;
    }
  }

  const baseRound = {
    id: round.id,
    room_id: round.room_id,
    round_num: round.round_num,
    question: round.question,
    category: round.category,
    phase: round.phase,
    started_at: round.started_at,
    answer_ends_at: round.answer_ends_at,
    reveal_ends_at: round.reveal_ends_at,
    ended_at: round.ended_at,
    options: publicOptions(round.options),
  };

  // Always load this round's answers (used for my_answer + answered roster, and
  // for reveal tallies/breakdown). choice_index is the caller's OWN row only in
  // the my_answer derivation; per-player choice indexes are NOT broadcast during
  // the answer phase (only the user-id roster is).
  const { data: answers } = await supabaseAdmin
    .from("trivia_answers")
    .select("user_id, choice_index, answered_at, is_correct, points_earned")
    .eq("round_id", round.id);
  const answerList = answers ?? [];

  const mine = answerList.find((a) => a.user_id === userId);
  const myAnswerOptionId =
    mine && typeof mine.choice_index === "number" ? String(mine.choice_index) : null;
  const answeredUserIds = answerList.map((a) => a.user_id);

  if (round.phase !== "reveal") {
    // Answer phase: NEVER ship correct_index, tallies, or other players' picks.
    return NextResponse.json({
      round: baseRound,
      my_answer_option_id: myAnswerOptionId,
      answered_count: answeredUserIds.length,
      answered_user_ids: answeredUserIds,
    });
  }

  // ── Reveal phase ──
  const correctOptionId = String(round.correct_index);

  // Per-option tallies (how many players picked each option).
  const optionTallies: Record<string, number> = {};
  publicOptions(round.options).forEach((o) => {
    optionTallies[o.id] = 0;
  });
  answerList.forEach((a) => {
    const key = String(a.choice_index);
    optionTallies[key] = (optionTallies[key] ?? 0) + 1;
  });

  // Per-player round points + breakdown. points_earned was banked by scoreRound;
  // we re-derive the base/speed/streak split here purely for the UI (it must add
  // up to the banked total). Window + prior-streak + the formula all come from
  // the SAME shared helpers scoreRound used, so the chips can't drift from the
  // banked value.
  const windowMs = triviaWindowMs(round.started_at, round.answer_ends_at);
  const priorStreak = await loadPriorStreak(
    supabaseAdmin,
    round.room_id,
    round.round_num,
  );
  const answerEndsAtMs = round.answer_ends_at
    ? new Date(round.answer_ends_at).getTime()
    : 0;

  const roundPoints: Record<string, number> = {};
  const breakdown: Record<
    string,
    { base: number; speed: number; streak: number; correct: boolean; streak_count: number }
  > = {};
  answerList.forEach((a) => {
    const uid = a.user_id;
    const isCorrect = a.choice_index === round.correct_index;
    const answeredAtMs = a.answered_at ? new Date(a.answered_at).getTime() : 0;
    const bd = computeTriviaBreakdown({
      isCorrect,
      answeredAtMs,
      // Mirror scoreRound's fallback: when answer_ends_at is missing, speed
      // collapses to 0 because answeredAt == endsAt.
      answerEndsAtMs: round.answer_ends_at ? answerEndsAtMs : answeredAtMs,
      windowMs,
      priorStreakCount: priorStreak.get(uid) ?? 0,
    });
    // Prefer the banked points_earned as the authoritative round total; the
    // base/speed/streak split is reconstructed for display. They agree by
    // construction (same formula), but the banked value is the source of truth.
    roundPoints[uid] =
      typeof a.points_earned === "number" ? a.points_earned : bd.points;
    breakdown[uid] = {
      base: bd.base,
      speed: bd.speed,
      streak: bd.streak,
      correct: bd.correct,
      streak_count: bd.streak_count,
    };
  });

  return NextResponse.json({
    round: { ...baseRound, correct_option_id: correctOptionId },
    my_answer_option_id: myAnswerOptionId,
    answered_count: answeredUserIds.length,
    answered_user_ids: answeredUserIds,
    reveal: {
      correct_option_id: correctOptionId,
      option_tallies: optionTallies,
      round_points: roundPoints,
      breakdown,
    },
  });
}
