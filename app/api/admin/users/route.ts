import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, maskEmail } from "@/lib/admin-auth";

/**
 * GET /api/admin/users?q=<search>&limit=<n> — user search + list. Staff only.
 *
 * Searches email / username / display name / exact UUID via the
 * admin_search_users RPC (migration 057, joins auth.users for email).
 * Emails are ALWAYS masked here — even for admins. Raw email is a separate
 * audited action: GET /api/admin/users/[id]/email.
 */
export async function GET(req: NextRequest) {
  const staff = await requireRole(req, "support");
  if (staff instanceof NextResponse) return staff;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const limitRaw = parseInt(req.nextUrl.searchParams.get("limit") ?? "25", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 25;

  const { data, error } = await supabaseAdmin.rpc("admin_search_users", {
    search: q,
    max_rows: limit,
  });
  if (error) {
    console.error("[admin/users] search failed:", error.message);
    return NextResponse.json({ error: "Search unavailable" }, { status: 500 });
  }

  const users = (data ?? []).map((u: Record<string, unknown>) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    emailMasked: maskEmail(typeof u.email === "string" ? u.email : null),
    role: u.role,
    coins: u.coins,
    level: u.level,
    plan: u.plan,
    createdAt: u.created_at,
    lastSeen: u.last_seen,
    suspended: Boolean(u.banned_until && new Date(String(u.banned_until)) > new Date()),
  }));

  return NextResponse.json({ users });
}
