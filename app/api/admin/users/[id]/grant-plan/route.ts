import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction, isUuid } from "@/lib/admin-auth";
import { createGrant, getActiveGrant, toActiveGrantDTO } from "@/lib/plan-grants";

/**
 * POST /api/admin/users/[id]/grant-plan — issue a manual paid-tier grant.
 * ADMIN ONLY (granting a paid tier has real economic value: multipliers,
 * cash-out caps, mastery access — same destructive-tier gate as fangs).
 *
 * Body: {
 *   tier: 'pro' | 'platinum',
 *   durationDays?: number | null   // null / omitted = lifetime grant
 *   reason?: string
 * }
 *
 * Inserts a plan_grants row then recomputes profiles.plan via the resolver
 * (Stripe baseline vs highest active grant — higher wins). Logs `plan_grant`
 * to admin_audit_log. Never downgrades a higher real Stripe tier.
 */

type RouteCtx = { params: { id: string } };

// Generous upper bound so a "lifetime-ish" grant can be expressed as days
// without a runaway value. ~27 years; lifetime grants use null instead.
const MAX_DURATION_DAYS = 10_000;

/**
 * GET /api/admin/users/[id]/grant-plan — read the user's current active grant
 * (or null). ADMIN ONLY: a grant row exposes who-granted it and the reason, so
 * this read is gated identically to the POST mutation and the rest of the admin
 * card (which only renders for admins).
 */
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  try {
    const grant = await toActiveGrantDTO(await getActiveGrant(params.id));
    return NextResponse.json({ grant });
  } catch (err) {
    console.error("[admin/grant-plan GET]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  let body: { tier?: unknown; durationDays?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tier = body.tier;
  if (tier !== "pro" && tier !== "platinum") {
    return NextResponse.json(
      { error: "tier must be 'pro' or 'platinum'" },
      { status: 400 },
    );
  }

  // durationDays: omitted or explicit null = lifetime. A number must be a
  // positive integer within bounds.
  let durationDays: number | null = null;
  if (body.durationDays != null) {
    const raw = body.durationDays;
    const n = typeof raw === "number" ? Math.trunc(raw) : NaN;
    if (!Number.isFinite(n) || n <= 0 || n > MAX_DURATION_DAYS) {
      return NextResponse.json(
        { error: `durationDays must be a positive integer up to ${MAX_DURATION_DAYS}, or null for lifetime` },
        { status: 400 },
      );
    }
    durationDays = n;
  }

  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";

  // Existence check up front so an unknown-but-valid uuid surfaces as a clean
  // 404 rather than a downstream resolver "profile not found" error.
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
    result = await createGrant({
      userId: params.id,
      tier,
      durationDays,
      grantedBy: staff.userId,
      reason: reason || null,
      source: "admin",
    });
  } catch (err) {
    console.error("[admin/grant-plan]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Grant failed" }, { status: 500 });
  }

  await logAdminAction({
    performedBy: staff.userId,
    action: "plan_grant",
    targetUserId: params.id,
    metadata: {
      tier,
      duration_days: durationDays,
      lifetime: durationDays == null,
      reason: reason || null,
      effective_plan: result.effectivePlan,
      grant_id: result.activeGrant?.id ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    plan: result.effectivePlan,
    grant: await toActiveGrantDTO(result.activeGrant),
  });
}
