import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { loadBlitzQuestions, getAvailableSubjects } from "@/lib/blitz-questions";

export const dynamic = "force-dynamic";

// GET /api/games/blitz/questions?subject=science&difficulty=medium
// Returns shuffled MCQ questions for a Blitz round.
// Blitz uses its own static JSON question pool (separate from question bank).
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

  const questions = loadBlitzQuestions(subject, difficulty, 50);

  if (questions.length === 0) {
    return NextResponse.json(
      { error: "No questions available for this combination" },
      { status: 404 },
    );
  }

  return NextResponse.json({ questions, total: questions.length });
}
