// POST /api/admin/team/reactivate — reactivate a suspended team member.
// ADMIN ONLY (destructive — it restores sign-in access).
//
// Body: { id: string }  // team_members.id (UUID)
//
// Effect (inverse of /api/admin/team/suspend):
//   1. If the row is linked to an auth account (user_id is set), lift the
//      Supabase auth ban (ban_duration: 'none'). This is the source of truth
//      for "can this person sign in" — they can authenticate again immediately.
//   2. Flip team_members.status -> 'active'.
//   3. Audit the action to admin_audit_log (append-only).
//
// Order: lift the ban FIRST, then mark the row active. If the status write
// fails after the ban is lifted, the account can sign in but the membership row
// still reads 'suspended' — we report failure so the operator retries (the
// retry is idempotent), and access being restored is the less-bad partial state
// to surface for a reactivation.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import { assertTrustedOrigin, UntrustedOriginError } from "@/lib/team/origin-check";
import { writeTeamAudit } from "@/lib/team/audit";
import type { TeamMember } from "@/lib/team/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  try {
    assertTrustedOrigin(req);
  } catch (err) {
    if (err instanceof UntrustedOriginError) {
      return NextResponse.json({ error: "Forbidden" }, { status: err.status });
    }
    throw err;
  }

  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid team member id" }, { status: 400 });
  }

  const { data: member, error: fetchError } = await supabaseAdmin
    .from("team_members")
    .select("id, user_id, status")
    .eq("id", id)
    .single<Pick<TeamMember, "id" | "user_id" | "status">>();

  if (fetchError || !member) {
    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("[team/reactivate] lookup failed:", fetchError.message);
    }
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  // An offboarded member is a terminal state — reactivation is not the right
  // path to bring them back (re-provision instead). Block it explicitly so we
  // never silently un-ban someone who was deliberately offboarded.
  if (member.status === "offboarded") {
    return NextResponse.json(
      { error: "Offboarded members cannot be reactivated; re-provision instead" },
      { status: 409 },
    );
  }

  // Lift the auth ban first. Only when a linked account exists.
  let authUnbanned = false;
  if (member.user_id) {
    const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(
      member.user_id,
      { ban_duration: "none" },
    );
    if (unbanError) {
      console.error("[team/reactivate] auth unban failed:", unbanError.message);
      return NextResponse.json({ error: "Reactivation failed" }, { status: 500 });
    }
    authUnbanned = true;
  }

  const { error: statusError } = await supabaseAdmin
    .from("team_members")
    .update({ status: "active" })
    .eq("id", id);

  if (statusError) {
    console.error("[team/reactivate] status update failed:", statusError.message);
    return NextResponse.json({ error: "Reactivation failed" }, { status: 500 });
  }

  await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "team_role_change",
    targetUserId: member.user_id,
    metadata: { to: "active", auth_unbanned: authUnbanned },
  });

  return NextResponse.json({ ok: true, status: "active" });
}
