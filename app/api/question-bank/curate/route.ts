import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { runCurationPipeline, getQuestionBankStats } from "@/lib/question-bank";

export const dynamic = "force-dynamic";

// POST /api/question-bank/curate
// Runs the auto-curation pipeline (promote, reject, adjust difficulty).
// Can be called manually by admin or on a cron schedule.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  // Only allow admin users to trigger curation
  // For now, any authenticated user can trigger it (add admin check later)
  const result = await runCurationPipeline();

  return NextResponse.json({
    success: true,
    ...result,
  });
}

// GET /api/question-bank/curate
// Returns stats about the question bank
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const stats = await getQuestionBankStats();
  return NextResponse.json(stats);
}
