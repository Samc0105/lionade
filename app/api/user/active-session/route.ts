/**
 * DELETE /api/user/active-session — explicit user-driven clear.
 *
 * Called by the ResumeBanner X-dismiss for sessions the user knows are
 * stale (e.g. abandoned mastery sessions). The default per-session
 * sessionStorage dismiss only hides the banner in the current tab; this
 * route nukes the server-side pointer so EVERY tab + future tab stops
 * showing the prompt.
 *
 * Idempotent: clearing a NULL active_session is a no-op (see
 * lib/presence:clearActiveSession + the clear_active_session RPC).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { clearActiveSession } from "@/lib/presence";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  await clearActiveSession(auth.userId);
  return NextResponse.json({ ok: true });
}
