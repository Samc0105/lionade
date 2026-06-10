/**
 * DELETE /api/user/active-session — explicit user-driven clear.
 *
 * Called by the staleness auto-reaper in lib/active-session.ts (the old
 * ResumeBanner X-dismiss caller was replaced by ActiveSessionToast, whose
 * Dismiss is sessionStorage-only and deliberately does NOT clear the
 * server pointer). This route nukes the server-side pointer so EVERY tab
 * + future tab stops showing the prompt.
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
