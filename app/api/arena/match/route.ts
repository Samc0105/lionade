import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET — Fetch match state (questions, answers, scores)
export async function GET(req: NextRequest) {
  try {
    const matchId = req.nextUrl.searchParams.get("id");
    const userId = req.nextUrl.searchParams.get("userId");
    if (!matchId || !userId) {
      return NextResponse.json({ error: "Missing id or userId" }, { status: 400 });
    }

    // Get match
    const { data: match, error } = await supabaseAdmin
      .from("arena_matches")
      .select("*")
      .eq("id", matchId)
      .single();

    if (error || !match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    // Verify user is a participant
    if (match.player1_id !== userId && match.player2_id !== userId) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }

    // Get both players' profiles
    const [{ data: p1 }, { data: p2 }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, arena_elo")
        .eq("id", match.player1_id)
        .single(),
      supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, arena_elo")
        .eq("id", match.player2_id)
        .single(),
    ]);

    // Get match questions with judge data (WITHOUT correct answers)
    const { data: matchQuestions } = await supabaseAdmin
      .from("arena_match_questions")
      .select("question_id, question_order, time_limit, cognitive_load")
      .eq("match_id", matchId)
      .order("question_order", { ascending: true });

    // Get question texts (no correct_answer — anti-cheat)
    const questionIds = (matchQuestions ?? []).map(mq => mq.question_id);
    let questions: { id: string; question: string; options: string[]; difficulty: string; subject: string }[] = [];

    if (questionIds.length > 0) {
      const { data: qs } = await supabaseAdmin
        .from("questions")
        .select("id, question, options, difficulty, subject")
        .in("id", questionIds);
      questions = (qs ?? []).map(q => ({ ...q, options: q.options as string[] }));
    }

    // Merge questions with judge data in correct order
    const orderedQuestions = (matchQuestions ?? []).map(mq => {
      const q = questions.find(x => x.id === mq.question_id);
      return {
        id: mq.question_id,
        order: mq.question_order,
        question: q?.question ?? "",
        options: q?.options ?? [],
        difficulty: q?.difficulty ?? "intermediate",
        subject: q?.subject ?? "",
        timeLimit: mq.time_limit,
        cognitiveLoad: mq.cognitive_load,
      };
    });

    // Get all answers for this match
    const { data: answers } = await supabaseAdmin
      .from("arena_answers")
      .select("question_id, user_id, is_correct, response_time_ms, points_earned, selected_answer")
      .eq("match_id", matchId);

    // Build per-question answer status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const answerMap: Record<string, { player1?: any; player2?: any }> = {};
    for (const a of answers ?? []) {
      if (!answerMap[a.question_id]) answerMap[a.question_id] = {};
      if (a.user_id === match.player1_id) answerMap[a.question_id].player1 = a;
      else if (a.user_id === match.player2_id) answerMap[a.question_id].player2 = a;
    }

    return NextResponse.json({
      match: {
        id: match.id,
        status: match.status,
        wager: match.wager,
        currentQuestion: match.current_question,
        player1Score: match.player1_total_points,
        player2Score: match.player2_total_points,
        winnerId: match.winner_id,
        player1EloBefore: match.player1_elo_before,
        player2EloBefore: match.player2_elo_before,
        player1EloAfter: match.player1_elo_after,
        player2EloAfter: match.player2_elo_after,
        createdAt: match.created_at,
        startedAt: match.started_at,
        completedAt: match.completed_at,
      },
      player1: p1 ? { id: p1.id, username: p1.username, avatarUrl: p1.avatar_url, elo: p1.arena_elo } : null,
      player2: p2 ? { id: p2.id, username: p2.username, avatarUrl: p2.avatar_url, elo: p2.arena_elo } : null,
      questions: orderedQuestions,
      answers: answerMap,
    });
  } catch (e) {
    console.error("[arena/match GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH — Update match status (start, advance question)
export async function PATCH(req: NextRequest) {
  try {
    const { matchId, userId, action } = await req.json();
    if (!matchId || !userId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if (action === "start") {
      await supabaseAdmin
        .from("arena_matches")
        .update({ status: "active", started_at: new Date().toISOString() })
        .eq("id", matchId)
        .in("status", ["pending"]);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
