// POST /api/admin/team/suspend — suspend a team member. ADMIN ONLY (destructive).
//
// Body: { id: string }  // team_members.id (UUID)
//
// Effect:
//   1. Flip team_members.status -> 'suspended'.
//   2. If the row is linked to an auth account (user_id is set), ban that
//      account at the Supabase auth layer. The ban is the SOURCE OF TRUTH for
//      "can this person sign in" and is also our global session kill: a banned
//      user's existing access tokens stop being honored at their next refresh
//      (~1h max), and no new tokens can be minted. supabase-js's
//      auth.admin.signOut requires the *target's* JWT (which a server-side
//      admin doesn't hold) and operates on a JWT, not a user id — so it's the
//      wrong primitive here and is intentionally not called. The ban achieves
//      the same "global sign-out" outcome with the id we actually have.
//   3. Audit the action to admin_audit_log (append-only).
//
// Order matters: we ban auth FIRST (the security-critical step), then mark the
// row. If the status write fails after a successful ban we still report failure,
// but the account is already locked out — failing safe.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import { assertTrustedOrigin, UntrustedOriginError } from "@/lib/team/origin-check";
import { writeTeamAudit } from "@/lib/team/audit";
import type { TeamMember } from "@/lib/team/types";

// 100 years ≈ permanent. 'none' lifts it (see reactivate route).
const BAN_DURATION = "876000h";

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

  // Existence check + grab the linked auth account (if any).
  const { data: member, error: fetchError } = await supabaseAdmin
    .from("team_members")
    .select("id, user_id, status")
    .eq("id", id)
    .single<Pick<TeamMember, "id" | "user_id" | "status">>();

  if (fetchError || !member) {
    // PGRST116 (no rows) is the expected "not found"; anything else is a real
    // DB fault but we still don't echo it to the client.
    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("[team/suspend] lookup failed:", fetchError.message);
    }
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  // Ban the auth account first (the security-critical step). Only attempt when a
  // linked account exists — a pending invite has no auth user yet.
  let authBanned = false;
  if (member.user_id) {
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
      member.user_id,
      { ban_duration: BAN_DURATION },
    );
    if (banError) {
      console.error("[team/suspend] auth ban failed:", banError.message);
      return NextResponse.json({ error: "Suspension failed" }, { status: 500 });
    }
    authBanned = true;
  }

  // Flip the membership status. updated_at is maintained by the table trigger.
  const { error: statusError } = await supabaseAdmin
    .from("team_members")
    .update({ status: "suspended" })
    .eq("id", id);

  if (statusError) {
    console.error("[team/suspend] status update failed:", statusError.message);
    // The auth account (if any) is already banned — the person is locked out,
    // which is the safe outcome — but the row is out of sync. Surface failure so
    // the operator retries; the retry is idempotent.
    return NextResponse.json({ error: "Suspension failed" }, { status: 500 });
  }

  await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "team_role_change",
    targetUserId: member.user_id,
    metadata: { to: "suspended", auth_banned: authBanned },
  });

  return NextResponse.json({ ok: true, status: "suspended" });
}
