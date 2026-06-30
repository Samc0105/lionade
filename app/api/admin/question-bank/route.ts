/**
 * /api/admin/question-bank — community question moderation (ADMIN ONLY).
 *
 * GET  ?status=pending&limit=50&offset=0 — list questions by status + the
 *      tab counts (getQuestionBankStats). Newest first.
 * POST { id, action: "approve" | "reject" } — human override that sets the
 *      question's status, beating the auto-curation pipeline.
 *
 * Security: requireRole(req, "admin") on BOTH handlers — moderation is a
 * destructive override, so it is admin-only (not support). This deliberately
 * does NOT use the legacy LIONADE_ADMIN_USER_IDS env allow-list from
 * /api/question-bank/curate (whose GET leaks stats to any authed user). All
 * DB access goes through supabaseAdmin (the table's RLS has no policies).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole, isUuid, logAdminAction } from "@/lib/admin-auth";
import { assertTrustedOrigin, UntrustedOriginError } from "@/lib/team/origin-check";
import {
  getQuestionBankStats,
  listQuestionsByStatus,
  setQuestionStatus,
} from "@/lib/question-bank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_STATUSES = ["pending", "approved", "rejected", "duplicate"] as const;
type ListStatus = (typeof LIST_STATUSES)[number];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  const statusParam = req.nextUrl.searchParams.get("status") ?? "pending";
  const status: ListStatus = (LIST_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as ListStatus)
    : "pending";

  const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
  const offsetRaw = Number(req.nextUrl.searchParams.get("offset"));
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const [stats, questions] = await Promise.all([
    getQuestionBankStats(),
    listQuestionsByStatus(status, limit, offset),
  ]);

  return NextResponse.json({ stats, status, questions });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  try {
    assertTrustedOrigin(req);
  } catch (err) {
    if (err instanceof UntrustedOriginError) {
      return NextResponse.json({ error: "Forbidden" }, { status: err.status });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const id = typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id : "";
  const action = (body as { action?: unknown }).action;

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid question id" }, { status: 400 });
  }
  // Only the two override actions are ever written. Mapping action -> status
  // here means an arbitrary client status string can never reach the DB CHECK.
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  const status = action === "approve" ? "approved" : "rejected";
  const result = await setQuestionStatus(id, status);
  if (!result.ok) {
    return NextResponse.json({ error: "Could not update that question" }, { status: 500 });
  }

  // Audit AFTER the write succeeds (never claims something that didn't happen).
  await logAdminAction({
    performedBy: staff.userId,
    action: "question_bank_moderate",
    metadata: { id, to: status },
  });

  return NextResponse.json({ success: true, id, status });
}
