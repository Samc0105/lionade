import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction } from "@/lib/admin-auth";

/**
 * GET /api/admin/users/[id]/email — reveal a user's raw email. ADMIN ONLY.
 *
 * Deliberately a separate endpoint (not part of the profile payload) so
 * every reveal is an explicit, audited act: writes a `view_email` row to
 * admin_audit_log. Support staff only ever see the masked form.
 */

type RouteCtx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(params.id);
  if (error || !data?.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await logAdminAction({
    performedBy: staff.userId,
    action: "view_email",
    targetUserId: params.id,
  });

  return NextResponse.json({ email: data.user.email ?? null });
}
