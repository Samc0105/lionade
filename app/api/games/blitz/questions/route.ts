import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { loadBlitzQuestions, getAvailableSubjects } from "@/lib/blitz-questions";
import { getApprovedQuestions } from "@/lib/question-bank";

export const dynamic = "force-dynamic";

// GET /api/games/blitz/questions?subject=science&difficulty=medium
// Returns shuffled MCQ questions for a Blitz round.
// Merges static JSON questions with approved question bank entries.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const subject = req.nextUrl.searchParams.get("subject") ?? undefined;
  const difficulty = req.nextUrl.searchParams.get("difficulty") ?? undefined;

  // Validate inputs
  const validSubjects = getAvailableSubjects();
  if (subject && !validSubjects.includes(subject)) {
    return NextResponse.json({ error: "Invalid subject" }, { status: 400 });
  }
  if (difficulty && !["easy", "medium", "hard"].includes(difficulty)) {
    return NextResponse.json({ error: "Invalid difficulty" }, { status: 400 });
  }

  // Load from static JSON files (primary source)
  const staticQuestions = loadBlitzQuestions(subject, difficulty, 40);

  // Load from question bank (approved AI-generated questions)
  let bankQuestions = await getApprovedQuestions(20, subject, difficulty);

  // Merge and shuffle
  const allQuestions = [...staticQuestions, ...bankQuestions];
  for (let i = allQuestions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
  }

  const questions = allQuestions.slice(0, 50);

  if (questions.length === 0) {
    return NextResponse.json(
      { error: "No questions available for this combination" },
      { status: 404 },
    );
  }

  return NextResponse.json({ questions, total: questions.length });
}
