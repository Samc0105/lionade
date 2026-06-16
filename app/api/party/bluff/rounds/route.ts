// POST /api/party/bluff/rounds — create a new Bluff Trivia round.
//
// Body: { code: string }
//
// Behavior:
//   - Verify caller is in the room and room.current_game === 'bluff'.
//   - Fetch a fresh question from Open Trivia DB (cached) or fallback bank.
//   - Insert a bluff_rounds row in phase='write' with the truth answer kept
//     server-side. Also insert the truth as a `bluff_answers` row with
//     is_truth=true (shuffled in at vote time alongside player fakes).
//   - Set write_ends_at = now + write_seconds.
//
// Note: we keep `correct_answer` on the bluff_rounds row but DO NOT return it
// to the client until phase advances to 'reveal' (filtered by the GET endpoint
// the client polls during write/vote phases).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { assertFeatureLive } from "@/lib/feature-flags";
import { recordFeatureError } from "@/lib/feature-health";
import { nextBluffQuestion } from "@/lib/party/bluff-questions";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { isRoomMember } from "@/lib/party/room-state";

const DEFAULT_WRITE_SECONDS = 45;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const m = await assertFeatureLive("games.party.bluff");
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
  if (room.current_game !== "bluff") {
    return NextResponse.json({ error: "Room is not playing bluff" }, { status: 400 });
  }

  const isMember = await isRoomMember(supabaseAdmin, room.id, userId);
  if (!isMember) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // Idempotency guard — if a round is already in flight (not yet revealed +
  // ended) for this room, hand it back instead of minting a duplicate. Covers
  // double NEXT ROUND clicks, two clients racing the effective-host derivation,
  // and the loading-rescue retry button in BluffView.
  const { data: inflight } = await supabaseAdmin
    .from("bluff_rounds")
    .select("id, room_id, round_num, question, category, phase, started_at, write_ends_at")
    .eq("room_id", room.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inflight) {
    return NextResponse.json({ round: inflight });
  }

  // Compute round number.
  const { data: prev } = await supabaseAdmin
    .from("bluff_rounds")
    .select("round_num")
    .eq("room_id", room.id)
    .order("round_num", { ascending: false })
    .limit(1);
  const nextRoundNum = (prev?.[0]?.round_num ?? 0) + 1;

  const question = await nextBluffQuestion();
  const writeSeconds = room.settings?.write_seconds ?? DEFAULT_WRITE_SECONDS;
  // +5s pad for the RoundCountdown overlay every client shows at round start,
  // so the countdown doesn't eat write time (mirrors Poker Face's
  // started_at + COUNTDOWN_SECONDS + DECIDE_SECONDS window). Clients derive
  // their timer purely from write_ends_at, so they agree automatically.
  const COUNTDOWN_PAD_SECONDS = 5;
  const writeEndsAt = new Date(
    Date.now() + (COUNTDOWN_PAD_SECONDS + writeSeconds) * 1000,
  ).toISOString();

  const { data: round, error } = await supabaseAdmin
    .from("bluff_rounds")
    .insert({
      room_id: room.id,
      round_num: nextRoundNum,
      question: question.question,
      correct_answer: question.correct_answer,
      category: question.category,
      phase: "write",
      write_ends_at: writeEndsAt,
    })
    .select()
    .single();
  if (error || !round) {
    // 23505 on UNIQUE (room_id, round_num): a parallel create won the race in
    // the window between the in-flight check above and our insert. Return the
    // winner's round so both callers converge on the same round id.
    if (error?.code === "23505") {
      const { data: winner } = await supabaseAdmin
        .from("bluff_rounds")
        .select("id, room_id, round_num, question, category, phase, started_at, write_ends_at")
        .eq("room_id", room.id)
        .eq("round_num", nextRoundNum)
        .maybeSingle();
      if (winner) return NextResponse.json({ round: winner });
    }
    recordFeatureError("games.party.bluff");
    console.error("[party/bluff/rounds] insert", error?.message);
    return NextResponse.json({ error: "Couldn't create round" }, { status: 500 });
  }

  // Insert the truth as a bluff_answers row (is_truth=true). The FK requires a
  // valid profiles.id, but the user_id here is just a placeholder. Pick any
  // non-creator member if available so the creator can still submit their own
  // fake under the legacy `UNIQUE (round_id, user_id)` constraint. Falls back
  // to the creator for solo-debug rooms; the answer route also self-heals.
  const { data: otherMember } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id")
    .eq("room_id", room.id)
    .neq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const truthOwnerId = otherMember?.user_id ?? userId;
  await supabaseAdmin.from("bluff_answers").insert({
    round_id: round.id,
    user_id: truthOwnerId,
    text: question.correct_answer,
    is_truth: true,
  });

  // V2 — promote any queued mid-game joiners into the active roster.
  await supabaseAdmin
    .from("party_room_players")
    .update({ is_pending_round: false })
    .eq("room_id", room.id)
    .is("left_at", null)
    .eq("is_pending_round", true);

  // Public payload: question + category + phase + timer. NEVER correct_answer.
  return NextResponse.json({
    round: {
      id: round.id,
      room_id: round.room_id,
      round_num: round.round_num,
      question: round.question,
      category: round.category,
      phase: round.phase,
      started_at: round.started_at,
      write_ends_at: round.write_ends_at,
    },
  });
}
