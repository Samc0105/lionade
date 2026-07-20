import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction, isUuid } from "@/lib/admin-auth";

/**
 * POST /api/admin/users/[id]/fangs — adjust a user's Fang balance. ADMIN ONLY
 * (deductions are destructive, so support is excluded from both directions).
 *
 * Body: { amount: integer (non-zero, |amount| <= 100000), reason: string (required) }
 *
 * Ledger correctness: positive amounts credit through source 'cashable';
 * negative amounts MUST debit through source 'spend' so the RPC drains
 * cashable-then-IAP and the `coins = fangs_cashable + fangs_iap` invariant
 * holds (a negative 'cashable' delta would clamp the bucket at 0 while
 * coins takes the full hit). Side effect: admin deductions increment
 * lifetime_fangs_spent — acceptable, noted in the audit metadata.
 *
 * Writes a coin_transactions row (type 'admin_adjustment', allowed by the
 * CHECK as of migration 057) and logs `fangs_adjust` to admin_audit_log.
 */

type RouteCtx = { params: { id: string } };

const MAX_ADJUST = 100_000;

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  if (params.id === staff.userId) {
    return NextResponse.json({ error: "You cannot adjust your own Fang balance" }, { status: 400 });
  }

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

  // Existence check up front — otherwise a valid-but-unknown uuid surfaces
  // as the RPC's 0-row "insufficient_coins", which is a confusing error.
  const { data: target, error: targetError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", params.id)
    .single();
  if (targetError || !target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin.rpc("update_user_coins", {
    p_user_id: params.id,
    p_delta: amount,
    p_min_balance: 0,
    p_source: amount > 0 ? "cashable" : "spend",
  });
  if (error) {
    const insufficient = error.message.includes("insufficient_coins");
    return NextResponse.json(
      { error: insufficient ? "User does not have enough Fangs for that deduction" : "Adjustment failed" },
      { status: insufficient ? 400 : 500 },
    );
  }

  const newBalance = Array.isArray(data) ? data[0]?.new_coins : (data as { new_coins?: number } | null)?.new_coins;

  const { error: ledgerError } = await supabaseAdmin.from("coin_transactions").insert({
    user_id: params.id,
    amount,
    type: "admin_adjustment",
    description: `Admin adjustment: ${reason}`,
  });
  if (ledgerError) {
    // Balance already changed — don't fail the request, but make the gap
    // loud: it lands in the audit metadata AND the server log.
    console.error("[admin/fangs] ledger insert failed:", ledgerError.message);
  }

  await logAdminAction({
    performedBy: staff.userId,
    action: "fangs_adjust",
    targetUserId: params.id,
    metadata: {
      amount,
      reason,
      new_balance: newBalance ?? null,
      source: amount > 0 ? "cashable" : "spend",
      ...(ledgerError ? { ledger_row_failed: true } : {}),
    },
  });

  return NextResponse.json({ ok: true, newBalance: newBalance ?? null });
}
