import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { requireRole } from "@/lib/admin-auth";
import { runCurationPipeline, getQuestionBankStats } from "@/lib/question-bank";

// Admin gate: set LIONADE_ADMIN_USER_IDS in env to a comma-separated list of
// user UUIDs allowed to POST this route. Without the env var, POST returns 403.
export const dynamic = "force-dynamic";

const ADMIN_IDS = (process.env.LIONADE_ADMIN_USER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// POST /api/question-bank/curate
// Runs the auto-curation pipeline (promote, reject, adjust difficulty).
// Admin-only: gated on LIONADE_ADMIN_USER_IDS env var.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (!ADMIN_IDS.includes(auth.userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await runCurationPipeline();

  return NextResponse.json({
    success: true,
    ...result,
  });
}

// GET /api/question-bank/curate
// Returns stats about the question bank. Admin-only: the stats are a moderation
// surface, so don't leak them to any authed user (the role-gated
// /api/admin/question-bank supersedes this legacy route).
export async function GET(req: NextRequest) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  const stats = await getQuestionBankStats();
  return NextResponse.json(stats);
}
