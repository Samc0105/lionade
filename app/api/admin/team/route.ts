// GET /api/admin/team — the full team roster. ADMIN ONLY.
//
// Returns every row in team_members, newest first. These rows carry NO
// secrets (no passwords, no API tokens, no recovery links — those are minted
// transiently by the provision/reset-password routes and never persisted), so
// `select("*")` is safe to return wholesale.
//
// Routing note: this dynamic file sits at /api/admin/team. The action routes
// (provision, offboard, reactivate, suspend, reset-password, check-username)
// are deeper STATIC segments under the same folder and take routing priority,
// so this GET never shadows them. The per-member GET lives in the separate
// [id] dynamic segment. There is no overlap.
//
// `force-dynamic` is intentionally NOT set here: the sibling read route
// (app/api/admin/audit-log/route.ts) does not set it, and an authenticated,
// per-request admin-gated handler is dynamic by nature (it reads the request
// to resolve the caller's role). We match the audit-log convention.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import type { TeamMember } from "@/lib/team/types";

export async function GET(req: NextRequest) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<TeamMember[]>();

  if (error) {
    console.error("[admin/team/list]", error.message);
    return NextResponse.json({ error: "Failed to load team" }, { status: 500 });
  }

  return NextResponse.json({ members: data ?? [] });
}
