import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";

/**
 * GET /api/admin/stats — dashboard overview metrics. Staff only (support+).
 *
 * Single round trip via the admin_dashboard_stats() RPC (migration 057):
 * total users, signups today / this week, active users (24h / 7d), and
 * total Fangs in circulation (display total + cashable/IAP ledger split).
 */
export async function GET(req: NextRequest) {
  const staff = await requireRole(req, "support");
  if (staff instanceof NextResponse) return staff;

  const { data, error } = await supabaseAdmin.rpc("admin_dashboard_stats");
  if (error) {
    console.error("[admin/stats] rpc failed:", error.message);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    totalUsers: Number(row?.total_users ?? 0),
    signupsToday: Number(row?.signups_today ?? 0),
    signupsWeek: Number(row?.signups_week ?? 0),
    activeToday: Number(row?.active_today ?? 0),
    activeWeek: Number(row?.active_week ?? 0),
    fangsTotal: Number(row?.fangs_total ?? 0),
    fangsCashable: Number(row?.fangs_cashable ?? 0),
    fangsIap: Number(row?.fangs_iap ?? 0),
  });
}
