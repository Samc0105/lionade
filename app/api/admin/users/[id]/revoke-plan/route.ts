import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction, isUuid } from "@/lib/admin-auth";
import { revokeActiveGrants, toActiveGrantDTO } from "@/lib/plan-grants";

/**
 * POST /api/admin/users/[id]/revoke-plan — soft-revoke all active manual
 * grants for a user. ADMIN ONLY (revocation removes a paid tier — destructive
 * in the same sense as a Fang deduction).
 *
 * Body: { reason?: string }
 *
 * Sets revoked_at on every active grant, then recomputes profiles.plan via the
 * resolver so the user drops to their real Stripe baseline (or to another
 * still-active grant, if any). Does NOT touch the user's Stripe subscription —
 * a paying subscriber keeps their paid tier. Logs `plan_revoke` to the audit
 * log. Revoking when there is nothing active is a clean no-op (revokedCount 0).
 */

type RouteCtx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  // Body is optional (reason only). Tolerate an empty/absent body.
  let reason = "";
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body.reason === "string") reason = body.reason.trim().slice(0, 300);
  } catch {
    // No body / invalid JSON is fine for a revoke — reason stays empty.
  }

  const { data: target, error: targetError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", params.id)
    .single();
  if (targetError || !target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let result;
  try {
    result = await revokeActiveGrants(params.id, staff.userId);
  } catch (err) {
    console.error("[admin/revoke-plan]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Revoke failed" }, { status: 500 });
  }

  await logAdminAction({
    performedBy: staff.userId,
    action: "plan_revoke",
    targetUserId: params.id,
    metadata: {
      revoked_count: result.revokedCount,
      reason: reason || null,
      effective_plan: result.effectivePlan,
    },
  });

  return NextResponse.json({
    ok: true,
    revokedCount: result.revokedCount,
    plan: result.effectivePlan,
    grant: await toActiveGrantDTO(result.activeGrant),
  });
}
