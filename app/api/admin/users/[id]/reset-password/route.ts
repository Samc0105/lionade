import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction } from "@/lib/admin-auth";
import { SITE_URL } from "@/lib/site-config";

/**
 * POST /api/admin/users/[id]/reset-password — send a password-reset email.
 * Support and admin. The most common customer-support action.
 *
 * The server looks up the email itself, so support staff can trigger a
 * reset without ever seeing the raw address. Logs `password_reset` to
 * admin_audit_log.
 */

type RouteCtx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "support");
  if (staff instanceof NextResponse) return staff;

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(params.id);
  if (error || !data?.user?.email) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(
    data.user.email,
    { redirectTo: `${SITE_URL}/login` },
  );
  if (resetError) {
    console.error("[admin/reset-password] failed:", resetError.message);
    return NextResponse.json({ error: "Reset email failed to send" }, { status: 500 });
  }

  await logAdminAction({
    performedBy: staff.userId,
    action: "password_reset",
    targetUserId: params.id,
  });

  return NextResponse.json({ ok: true });
}
