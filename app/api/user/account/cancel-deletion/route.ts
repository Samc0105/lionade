/**
 * POST /api/user/account/cancel-deletion — abort a scheduled hard delete.
 *
 * Settings overhaul 2026-06-11. Pairs with the deferred DELETE on
 * /api/user/account: clears profiles.pending_deletion_at (set null) so the
 * reaper cron (/api/cron/reap-pending-deletions) skips the account.
 *
 * Surfaced from two places, both of which call this route:
 *   - the global PendingDeletionBanner in app/settings/layout.tsx
 *   - the scheduled-deletion state on the Danger Zone page
 *
 * Idempotent: clearing an already-null column is a no-op success, so a
 * double-click or a stale banner can't error.
 *
 * Returns { ok: true }.
 *
 * Auth: requireAuth. Acts only on auth.userId — no body-trusted id.
 * Demo user: NOT blocked. The demo can never schedule a deletion (DELETE is
 * demo-blocked), so cancel is harmless for it and there's no reason to 403.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ pending_deletion_at: null })
    .eq("id", auth.userId);

  if (error) {
    console.error("[api/user/account/cancel-deletion]", error.message);
    return NextResponse.json({ error: "Failed to cancel deletion" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
