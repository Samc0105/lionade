import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction } from "@/lib/admin-auth";

/**
 * POST /api/admin/users/[id]/fangs — adjust a user's Fang balance. ADMIN ONLY
 * (deductions are destructive, so support is excluded from both directions).
 *
 * Body: { amount: integer (non-zero, |amount| <= 100000), reason: string (required) }
 *
 * Goes through the update_user_coins RPC (source 'cashable') so the
 * coins + fangs_cashable ledger stays consistent, writes a
 * coin_transactions row (type 'admin_adjustment'), and logs `fangs_adjust`
 * with the amount + reason to admin_audit_log.
 */

type RouteCtx = { params: { id: string } };

const MAX_ADJUST = 100_000;

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  let body: { amount?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amount = typeof body.amount === "number" ? Math.trunc(body.amount) : NaN;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";

  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_ADJUST) {
    return NextResponse.json(
      { error: `Amount must be a non-zero integer up to ±${MAX_ADJUST.toLocaleString()}` },
      { status: 400 },
    );
  }
  if (reason.length < 3) {
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("update_user_coins", {
    p_user_id: params.id,
    p_delta: amount,
    p_min_balance: 0,
    p_source: "cashable",
  });
  if (error) {
    const insufficient = error.message.includes("insufficient_coins");
    return NextResponse.json(
      { error: insufficient ? "User does not have enough Fangs for that deduction" : "Adjustment failed" },
      { status: insufficient ? 400 : 500 },
    );
  }

  const newBalance = Array.isArray(data) ? data[0]?.new_coins : (data as { new_coins?: number } | null)?.new_coins;

  await supabaseAdmin.from("coin_transactions").insert({
    user_id: params.id,
    amount,
    type: "admin_adjustment",
    description: `Admin adjustment: ${reason}`,
  });

  await logAdminAction({
    performedBy: staff.userId,
    action: "fangs_adjust",
    targetUserId: params.id,
    metadata: { amount, reason, new_balance: newBalance ?? null },
  });

  return NextResponse.json({ ok: true, newBalance: newBalance ?? null });
}
