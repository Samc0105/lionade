// Competitive platform — SERVER-AUTHORITATIVE per-round answer submit.
//
// POST /api/competitive/match/[id]/answer
// Body (mode-specific RAW answer ONLY — never a score):
//   sabotage: { roundNum, index }
//   zoom:     { roundNum, guess, elapsedMs }
//   spectrum: { roundNum, guess }
//   pin:      { roundNum, lat, lng }
//
// Why this exists (HIGH 5 fix): before this, each mode screen read the round
// SECRET (correct_index / answer / true_value / true_lat,lng) out of the match
// payload, scored itself client-side, and POSTed the resulting score to
// /complete — so a tampered client could submit any score and win. Now:
//   1. The client submits ONLY its raw guess.
//   2. The server reads the secret (service-role, RLS-bypassing) and SCORES it
//      via lib/competitive/score-answer.ts.
//   3. The score is persisted to competitive_responses; /complete sums those.
//   4. The reveal (the secret for THIS just-answered round) is returned so the
//      screen can render its reveal UI — it never held the secret beforehand.
//
// Security:
//   - userId comes ONLY from requireAuth (never the body).
//   - Only a match participant may submit.
//   - One scored response per (match, round, user): the UNIQUE constraint makes
//     resubmits idempotent (we return the already-scored row, never re-credit).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  scoreSabotageAnswer,
  scoreZoomAnswer,
  scoreSpectrumAnswer,
  scorePinAnswer,
  isScoredMode,
  type ScoredAnswer,
} from "@/lib/competitive/score-answer";
import type { CompetitiveMatchRow } from "@/lib/competitive/types";

const ROUND_TABLE: Record<string, string> = {
  sabotage: "sabotage_rounds",
  zoom: "zoom_rounds",
  spectrum: "spectrum_rounds",
  pin: "pin_rounds",
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const matchId = params.id;

  try {
    const body = await req.json().catch(() => ({}));
    const roundNum: number = Number.isInteger(body?.roundNum) ? body.roundNum : -1;
    if (roundNum < 0) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const { data: matchRaw } = await supabaseAdmin
      .from("competitive_matches")
      .select("*")
      .eq("id", matchId)
      .single();
    if (!matchRaw) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
    const match = matchRaw as CompetitiveMatchRow;
    const participants = [...match.team_a, ...match.team_b];
    if (!participants.includes(userId)) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }
    if (!isScoredMode(match.mode)) {
      // Poker Face settles per-hand server-side already; it has no /answer path.
      return NextResponse.json({ error: "Mode is not answer-scored" }, { status: 400 });
    }

    const roundTable = ROUND_TABLE[match.mode];
    const { data: round } = await supabaseAdmin
      .from(roundTable)
      .select("*")
      .eq("match_id", matchId)
      .eq("round_num", roundNum)
      .maybeSingle();
    if (!round) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }

    // Idempotency: if we already scored this user for this round, return it
    // verbatim (with the reveal) — never re-credit a second submission.
    const { data: existing } = await supabaseAdmin
      .from("competitive_responses")
      .select("points, is_correct, raw_answer")
      .eq("match_id", matchId)
      .eq("round_num", roundNum)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        alreadyAnswered: true,
        points: existing.points,
        isCorrect: existing.is_correct,
        reveal: revealFor(match.mode, round),
      });
    }

    // ── Score the raw answer against the secret (server-side) ──
    let scored: ScoredAnswer;
    let rawAnswer: Record<string, unknown>;
    switch (match.mode) {
      case "sabotage":
        rawAnswer = { index: body?.index };
        scored = scoreSabotageAnswer(round, body?.index);
        break;
      case "zoom":
        rawAnswer = { guess: body?.guess, elapsedMs: body?.elapsedMs };
        scored = scoreZoomAnswer(round, body?.guess, body?.elapsedMs);
        break;
      case "spectrum":
        rawAnswer = { guess: body?.guess };
        scored = scoreSpectrumAnswer(round, body?.guess);
        break;
      case "pin":
        rawAnswer = { lat: body?.lat, lng: body?.lng };
        scored = scorePinAnswer(round, body?.lat, body?.lng);
        break;
      default:
        return NextResponse.json({ error: "Mode is not answer-scored" }, { status: 400 });
    }

    // Persist the server-scored response (idempotent on the UNIQUE constraint —
    // a race that loses the insert simply means the other write already scored
    // this user; we re-read and return it).
    const { error: insErr } = await supabaseAdmin
      .from("competitive_responses")
      .insert({
        match_id: matchId,
        round_num: roundNum,
        mode: match.mode,
        user_id: userId,
        raw_answer: rawAnswer,
        is_correct: scored.isCorrect,
        points: scored.points,
      });
    if (insErr) {
      const { data: race } = await supabaseAdmin
        .from("competitive_responses")
        .select("points, is_correct")
        .eq("match_id", matchId)
        .eq("round_num", roundNum)
        .eq("user_id", userId)
        .maybeSingle();
      if (race) {
        return NextResponse.json({
          alreadyAnswered: true,
          points: race.points,
          isCorrect: race.is_correct,
          reveal: scored.reveal,
        });
      }
      console.error("[competitive/answer] insert", insErr.message);
      return NextResponse.json({ error: "Could not record answer" }, { status: 500 });
    }

    // Mark the round ended once EVERY participant has submitted for it, so the
    // owner-or-ended RLS lets clients read the row directly afterward (history /
    // late refetch) and stays consistent with the reveal we just returned.
    const { count } = await supabaseAdmin
      .from("competitive_responses")
      .select("user_id", { count: "exact", head: true })
      .eq("match_id", matchId)
      .eq("round_num", roundNum);
    if ((count ?? 0) >= participants.length && !round.ended_at) {
      await supabaseAdmin
        .from(roundTable)
        .update({ ended_at: new Date().toISOString() })
        .eq("id", round.id)
        .is("ended_at", null);
    }

    return NextResponse.json({
      points: scored.points,
      isCorrect: scored.isCorrect,
      reveal: scored.reveal,
    });
  } catch (e) {
    console.error("[competitive/answer]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** Build the reveal object from a full round row (used on the idempotent path). */
function revealFor(mode: string, round: Record<string, unknown>): Record<string, unknown> {
  switch (mode) {
    case "sabotage":
      return { correct_index: round.correct_index };
    case "zoom":
      return { answer: round.answer };
    case "spectrum":
      return { true_value: round.true_value };
    case "pin":
      return { true_lat: round.true_lat, true_lng: round.true_lng };
    default:
      return {};
  }
}
