import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction, isUuid } from "@/lib/admin-auth";

/**
 * GET /api/admin/users/[id]/email — reveal a user's raw email. ADMIN ONLY.
 *
 * Deliberately a separate endpoint (not part of the profile payload) so
 * every reveal is an explicit, audited act. The audit row is written
 * BEFORE the email is returned, and a failed audit write blocks the
 * reveal — no audit trail, no email.
 */

type RouteCtx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(params.id);
  if (error || !data?.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const audit = await logAdminAction({
    performedBy: staff.userId,
    action: "view_email",
    targetUserId: params.id,
  });
  if (!audit.ok) {
    return NextResponse.json(
      { error: "Audit log write failed; email not revealed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ email: data.user.email ?? null });
}
