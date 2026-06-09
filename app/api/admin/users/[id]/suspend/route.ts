import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction, isUuid } from "@/lib/admin-auth";

/**
 * POST /api/admin/users/[id]/suspend — suspend or reinstate an account.
 * ADMIN ONLY (destructive).
 *
 * Body: { suspend: boolean, reason?: string }
 *
 * Implemented as a Supabase auth ban (ban_duration), the source of truth
 * for "can this account sign in." 100 years ≈ permanent; 'none' lifts it.
 * Existing sessions die at next token refresh (~1h max). Logs `suspend` /
 * `unsuspend` with the reason.
 */

type RouteCtx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  if (params.id === staff.userId) {
    return NextResponse.json(
      { error: "You cannot suspend your own account" },
      { status: 400 },
    );
  }

  let body: { suspend?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Strict boolean — a malformed body must never silently reinstate a
  // banned account.
  if (typeof body.suspend !== "boolean") {
    return NextResponse.json(
      { error: "Body must include suspend: true | false" },
      { status: 400 },
    );
  }
  const suspend = body.suspend;
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";

  const { error } = await supabaseAdmin.auth.admin.updateUserById(params.id, {
    ban_duration: suspend ? "876000h" : "none",
  });
  if (error) {
    console.error("[admin/suspend] failed:", error.message);
    return NextResponse.json({ error: "Suspension update failed" }, { status: 500 });
  }

  await logAdminAction({
    performedBy: staff.userId,
    action: suspend ? "suspend" : "unsuspend",
    targetUserId: params.id,
    metadata: reason ? { reason } : {},
  });

  return NextResponse.json({ ok: true, suspended: suspend });
}
