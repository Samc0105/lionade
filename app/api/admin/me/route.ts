import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getUserRole } from "@/lib/admin-auth";

/**
 * GET /api/admin/me — the caller's app role ('user' | 'support' | 'admin').
 *
 * The one /api/admin route any signed-in user may hit: the Navbar and the
 * /admin layout use it to decide whether the Admin surface exists at all.
 * Regular users just get { role: "user" } — nothing sensitive leaks.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const role = await getUserRole(auth.userId);
  return NextResponse.json({ role });
}
