// POST /api/party/trivia/rounds — create a new Trivia (Lightning Round) round.
//
// Body: { code: string }
//
// Behavior (mirrors app/api/party/bluff/rounds/route.ts):
//   - Verify caller is in the room and room.current_game === 'trivia'.
//   - Fetch a fresh MCQ question + shuffle its 4 options server-side, keeping
//     correct_index secret on the row.
//   - Insert a trivia_rounds row in phase='answer' with answer_ends_at set.
//   - In-flight idempotency: hand back any not-yet-ended round instead of
//     minting a duplicate (double NEXT clicks, racing host derivation, retry).
//   - 23505 recovery on UNIQUE(room_id, round_num); promote mid-game joiners.
//
// We keep `correct_index` on the row but NEVER return it during the answer
// phase (the GET filters it until phase==='reveal').

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { assertFeatureLive } from "@/lib/feature-flags";
import { recordFeatureError } from "@/lib/feature-health";
import { nextTriviaQuestion, buildShuffledOptions } from "@/lib/party/trivia-questions";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { isRoomMember } from "@/lib/party/room-state";
import { publicOptions } from "@/lib/party/trivia-advance";

const DEFAULT_ANSWER_SECONDS = 12;
// +5s pad for the RoundCountdown overlay every client shows at round start, so
// the countdown doesn't eat answer time (mirrors bluff's COUNTDOWN_PAD). Clients
// derive their timer purely from answer_ends_at, so they agree automatically.
const COUNTDOWN_PAD_SECONDS = 5;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const m = await assertFeatureLive("games.party.trivia");
  if (m) return m;

  const body = await req.json().catch(() => ({}));
  const code = normalizeRoomCode(body?.code ?? "");
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, current_game, settings")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.current_game !== "trivia") {
    return NextResponse.json({ error: "Room is not playing trivia" }, { status: 400 });
  }

  const isMember = await isRoomMember(supabaseAdmin, room.id, userId);
  if (!isMember) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // Idempotency guard — if a round is already in flight (not yet ended) for this
  // room, hand it back instead of minting a duplicate.
  const { data: inflight } = await supabaseAdmin
    .from("trivia_rounds")
    .select("id, room_id, round_num, question, category, phase, started_at, answer_ends_at, options")
    .eq("room_id", room.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inflight) {
    return NextResponse.json({
      round: {
        id: inflight.id,
        room_id: inflight.room_id,
        round_num: inflight.round_num,
        question: inflight.question,
        category: inflight.category,
        phase: inflight.phase,
        started_at: inflight.started_at,
        answer_ends_at: inflight.answer_ends_at,
        options: publicOptions(inflight.options),
      },
    });
  }

  // Compute round number.
  const { data: prev } = await supabaseAdmin
    .from("trivia_rounds")
    .select("round_num")
    .eq("room_id", room.id)
    .order("round_num", { ascending: false })
    .limit(1);
  const nextRoundNum = (prev?.[0]?.round_num ?? 0) + 1;

  const q = await nextTriviaQuestion();
  const { options, correct_index } = buildShuffledOptions(q);

  const answerSeconds = room.settings?.trivia_answer_seconds ?? DEFAULT_ANSWER_SECONDS;
  const answerEndsAt = new Date(
    Date.now() + (COUNTDOWN_PAD_SECONDS + answerSeconds) * 1000,
  ).toISOString();

  const { data: round, error } = await supabaseAdmin
    .from("trivia_rounds")
    .insert({
      room_id: room.id,
      round_num: nextRoundNum,
      question: q.question,
      category: q.category,
      options,
      correct_index,
      phase: "answer",
      answer_ends_at: answerEndsAt,
    })
    .select()
    .single();
  if (error || !round) {
    // 23505 on UNIQUE (room_id, round_num): a parallel create won the race in
    // the window between the in-flight check and our insert. Return the winner.
    if (error?.code === "23505") {
      const { data: winner } = await supabaseAdmin
        .from("trivia_rounds")
        .select("id, room_id, round_num, question, category, phase, started_at, answer_ends_at, options")
        .eq("room_id", room.id)
        .eq("round_num", nextRoundNum)
        .maybeSingle();
      if (winner) {
        return NextResponse.json({
          round: {
            id: winner.id,
            room_id: winner.room_id,
            round_num: winner.round_num,
            question: winner.question,
            category: winner.category,
            phase: winner.phase,
            started_at: winner.started_at,
            answer_ends_at: winner.answer_ends_at,
            options: publicOptions(winner.options),
          },
        });
      }
    }
    recordFeatureError("games.party.trivia");
    console.error("[party/trivia/rounds] insert", error?.message);
    return NextResponse.json({ error: "Couldn't create round" }, { status: 500 });
  }

  // V2 — promote any queued mid-game joiners into the active roster.
  await supabaseAdmin
    .from("party_room_players")
    .update({ is_pending_round: false })
    .eq("room_id", room.id)
    .is("left_at", null)
    .eq("is_pending_round", true);

  // Public payload: question + category + options (no correct_index).
  return NextResponse.json({
    round: {
      id: round.id,
      room_id: round.room_id,
      round_num: round.round_num,
      question: round.question,
      category: round.category,
      phase: round.phase,
      started_at: round.started_at,
      answer_ends_at: round.answer_ends_at,
      options: publicOptions(round.options),
    },
  });
}
