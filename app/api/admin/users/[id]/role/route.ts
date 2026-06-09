import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction, isUuid, type AppRole } from "@/lib/admin-auth";

/**
 * POST /api/admin/users/[id]/role — change a user's role. ADMIN ONLY.
 *
 * Body: { role: 'user' | 'support' | 'admin' }
 *
 * Admins cannot change their OWN role — prevents the last admin from
 * accidentally locking everyone out (and a hijacked admin session from
 * quietly demoting the owner). Logs `role_change` with old → new.
 */

type RouteCtx = { params: { id: string } };

const VALID_ROLES: AppRole[] = ["user", "support", "admin"];

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  if (params.id === staff.userId) {
    return NextResponse.json(
      { error: "You cannot change your own role" },
      { status: 400 },
    );
  }

  let body: { role?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newRole = body.role as AppRole;
  if (!VALID_ROLES.includes(newRole)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const { data: current, error: readError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", params.id)
    .single();
  if (readError || !current) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const oldRole = (current.role as AppRole) ?? "user";
  if (oldRole === newRole) {
    return NextResponse.json({ ok: true, role: newRole });
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ role: newRole })
    .eq("id", params.id);
  if (error) {
    console.error("[admin/role] update failed:", error.message);
    return NextResponse.json({ error: "Role change failed" }, { status: 500 });
  }

  await logAdminAction({
    performedBy: staff.userId,
    action: "role_change",
    targetUserId: params.id,
    metadata: { from: oldRole, to: newRole },
  });

  return NextResponse.json({ ok: true, role: newRole });
}
