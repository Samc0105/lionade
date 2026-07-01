/**
 * Quiz ↔ question-bank bridge. question_bank is service-role-only (RLS with no
 * policies), so the anon client behind getQuizQuestions/checkAnswer can't touch
 * it. This auth-gated server route is the proxy:
 *
 *   GET  ?subject=&difficulty=&topic=  -> { questions: [{id, subject, question,
 *        options, difficulty}] }   approved community questions to BLEND into a
 *        quiz. Never includes correct_index (anti-cheat).
 *   POST { questionId }               -> { correctIndex, explanation } | 404
 *        grades ONE blended bank question by id (reads correct_index via
 *        supabaseAdmin). Static `questions` are graded elsewhere via the user
 *        token; this only covers the bank half.
 *
 * Mirrors the Blitz blend pattern (app/api/games/blitz/questions) but the quiz
 * path is anti-cheat: the correct answer is never sent with the question.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getApprovedQuestionsWithId, getBankAnswer } from "@/lib/question-bank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const subject = req.nextUrl.searchParams.get("subject") ?? undefined;
  const difficulty = req.nextUrl.searchParams.get("difficulty") ?? undefined;
  const topic = req.nextUrl.searchParams.get("topic") ?? undefined;

  let questions: Awaited<ReturnType<typeof getApprovedQuestionsWithId>> = [];
  try {
    questions = await getApprovedQuestionsWithId(20, subject, difficulty, topic);
  } catch {
    questions = [];
  }
  return NextResponse.json({ questions });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const questionId = (body as { questionId?: unknown }).questionId;
  if (typeof questionId !== "string" || !questionId) {
    return NextResponse.json({ error: "Missing questionId" }, { status: 400 });
  }

  const answer = await getBankAnswer(questionId);
  if (!answer) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  return NextResponse.json(answer);
}
