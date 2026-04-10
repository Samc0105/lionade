import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

// Minimum reaction time floor — humans can't reliably react faster than this.
// Clamping protects the speed-bonus mechanic from trivial bots that always
// report responseTimeMs=0.
const MIN_REACTION_MS = 500;

// POST — Submit an answer (server-validated)
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json();
    const { matchId, questionId, selectedAnswer } = body;
    const rawResponseTime = Number(body.responseTimeMs);

    if (!matchId || !questionId || selectedAnswer === undefined) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Verify match exists and is active
    const { data: match } = await supabaseAdmin
      .from("arena_matches")
      .select("id, player1_id, player2_id, status")
      .eq("id", matchId)
      .single();

    if (!match || match.status !== "active") {
      return NextResponse.json({ error: "Match not active" }, { status: 400 });
    }

    if (match.player1_id !== userId && match.player2_id !== userId) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }

    // Check if already answered this question
    const { data: existing } = await supabaseAdmin
      .from("arena_answers")
      .select("id")
      .eq("match_id", matchId)
      .eq("question_id", questionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Already answered" }, { status: 400 });
    }

    // Get correct answer from DB
    const { data: question } = await supabaseAdmin
      .from("questions")
      .select("correct_answer, explanation")
      .eq("id", questionId)
      .single();

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    const correctAnswer = Number(question.correct_answer);
    const isCorrect = selectedAnswer === correctAnswer;

    // Get time_limit from judge data
    const { data: matchQ } = await supabaseAdmin
      .from("arena_match_questions")
      .select("time_limit")
      .eq("match_id", matchId)
      .eq("question_id", questionId)
      .single();

    const timeLimit = matchQ?.time_limit ?? 15;
    const timeLimitMs = timeLimit * 1000;

    // Clamp client-supplied response time so a bot can't always send 0 for max
    // bonus. Humans can't reliably react faster than ~250ms; 500ms floor is
    // generous. Cap at the question time limit.
    const clampedResponseMs = Number.isFinite(rawResponseTime)
      ? Math.max(MIN_REACTION_MS, Math.min(timeLimitMs, rawResponseTime))
      : timeLimitMs;

    // Calculate points with speed bonus
    let points = 0;
    if (isCorrect) {
      points = 10; // base
      const pct = clampedResponseMs / timeLimitMs;
      if (pct < 0.3) points += 5;
      else if (pct < 0.5) points += 3;
      else if (pct < 0.75) points += 1;
    }

    // Insert answer
    const { error: insertErr } = await supabaseAdmin
      .from("arena_answers")
      .insert({
        match_id: matchId,
        question_id: questionId,
        user_id: userId,
        selected_answer: selectedAnswer >= 0 ? selectedAnswer : null,
        is_correct: isCorrect,
        response_time_ms: clampedResponseMs,
        points_earned: points,
      });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // Update match score
    const isPlayer1 = match.player1_id === userId;
    const scoreField = isPlayer1 ? "player1_total_points" : "player2_total_points";
    const correctField = isPlayer1 ? "player1_score" : "player2_score";

    const { data: currentMatch } = await supabaseAdmin
      .from("arena_matches")
      .select("player1_total_points, player2_total_points, player1_score, player2_score")
      .eq("id", matchId)
      .single();

    if (currentMatch) {
      const updates: Record<string, number> = {
        [scoreField]: (currentMatch[scoreField as keyof typeof currentMatch] as number) + points,
      };
      if (isCorrect) {
        updates[correctField] = (currentMatch[correctField as keyof typeof currentMatch] as number) + 1;
      }
      await supabaseAdmin.from("arena_matches").update(updates).eq("id", matchId);
    }

    // Check if both players have answered this question
    const { data: bothAnswers } = await supabaseAdmin
      .from("arena_answers")
      .select("user_id, is_correct, points_earned, selected_answer, response_time_ms")
      .eq("match_id", matchId)
      .eq("question_id", questionId);

    const bothAnswered = (bothAnswers?.length ?? 0) >= 2;

    return NextResponse.json({
      isCorrect,
      correctAnswer,
      explanation: question.explanation,
      pointsEarned: points,
      bothAnswered,
      opponentAnswer: bothAnswered
        ? bothAnswers?.find(a => a.user_id !== userId)
        : null,
    });
  } catch (e) {
    console.error("[arena/answer POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
