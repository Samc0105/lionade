import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";

/**
 * GET /api/admin/audit-log — who did what to whom, and when. ADMIN ONLY.
 *
 * Query params:
 *   action  — exact action filter (password_reset, fangs_adjust, ...)
 *   user    — uuid, matches EITHER performer or target
 *   page    — 0-based, 50 rows per page
 *
 * Usernames for performer/target are resolved in a second query so the
 * table can show names instead of raw uuids.
 */

const PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  const sp = req.nextUrl.searchParams;
  const action = (sp.get("action") ?? "").trim().slice(0, 50);
  const userFilter = (sp.get("user") ?? "").trim();
  const pageRaw = parseInt(sp.get("page") ?? "0", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 0;

  let query = supabaseAdmin
    .from("admin_audit_log")
    .select("id, performed_by, action, target_user_id, metadata, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (action) query = query.eq("action", action);
  if (UUID_RE.test(userFilter)) {
    query = query.or(`performed_by.eq.${userFilter},target_user_id.eq.${userFilter}`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[admin/audit-log] query failed:", error.message);
    return NextResponse.json({ error: "Audit log unavailable" }, { status: 500 });
  }

  const rows = data ?? [];
  const ids = Array.from(
    new Set(
      rows.flatMap((r) => [r.performed_by, r.target_user_id]).filter(Boolean),
    ),
  ) as string[];

  const usernames: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .in("id", ids);
    for (const p of profiles ?? []) usernames[p.id] = p.username ?? p.id;
  }

  return NextResponse.json({
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      performedBy: r.performed_by,
      performedByName: usernames[r.performed_by] ?? r.performed_by,
      targetUserId: r.target_user_id,
      targetName: r.target_user_id
        ? (usernames[r.target_user_id] ?? r.target_user_id)
        : null,
      metadata: r.metadata ?? {},
      createdAt: r.created_at,
    })),
    page,
    pageSize: PAGE_SIZE,
    total: count ?? rows.length,
  });
}
