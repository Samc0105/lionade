import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { loadBlitzQuestions, getAvailableSubjects } from "@/lib/blitz-questions";
import { getApprovedQuestions } from "@/lib/question-bank";
import { shuffleArray } from "@/lib/utils";
import type { MCQQuestion } from "@/lib/ninny";

// How many of a 50-question round we reserve for fresh community questions
// when any are available. The static pool fills the rest, so the bank can
// surface even on subjects whose static file is already full.
const COMMUNITY_SLOTS = 10;

export const dynamic = "force-dynamic";

// GET /api/games/blitz/questions?subject=science&difficulty=medium
// Returns shuffled MCQ questions for a Blitz round.
// Backbone is the static JSON pool; we blend in a slice of curated, approved
// questions from the self-growing question bank (the curation cron promotes
// them). The blend is additive and best-effort so the static pool is always
// the guaranteed floor.
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

  // Blend in approved community questions (auto-promoted by the curation cron).
  // Best-effort: getApprovedQuestions already returns [] on any error, and the
  // try/catch double-guards it, so a Supabase outage or empty bank degrades to
  // today's exact static-pool behavior. This is the consumer that finally turns
  // the content flywheel — generate -> record performance -> curate -> SERVE.
  let approved: MCQQuestion[] = [];
  try {
    approved = await getApprovedQuestions(15, subject, difficulty);
  } catch {
    approved = [];
  }

  // De-dupe by question text so a bank copy of a static question can't double
  // up in the same round.
  const seen = new Set(questions.map((q) => q.question.trim().toLowerCase()));
  const fresh = approved.filter((q) => !seen.has(q.question.trim().toLowerCase()));

  // Reserve up to COMMUNITY_SLOTS for fresh community questions, then fill the
  // rest from the static pool and shuffle so they're interspersed (not bolted
  // on the end). loadBlitzQuestions already returns up to 50, so a plain
  // append-then-truncate would drop every community question on full subjects;
  // reserving slots is what actually lets the flywheel serve. When the bank is
  // empty (young app / outage) `fresh` is [], so we return the static set
  // unchanged — zero behavior change in the common case.
  const reservedFresh = fresh.slice(0, COMMUNITY_SLOTS);
  const blended =
    reservedFresh.length > 0
      ? shuffleArray([...questions.slice(0, 50 - reservedFresh.length), ...reservedFresh])
      : questions;

  if (blended.length === 0) {
    return NextResponse.json(
      { error: "No questions available for this combination" },
      { status: 404 },
    );
  }

  return NextResponse.json({ questions: blended, total: blended.length });
}
