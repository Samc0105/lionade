/**
 * POST /api/user/account/deactivate — soft-deactivate the caller's account.
 *
 * Settings overhaul 2026-06-11. Distinct from DELETE (which schedules a hard
 * delete): deactivation is fully reversible and keeps all data.
 *
 * Effect (both writes are the must-have contract):
 *   1. profiles.deactivated_at  = now()      — marks the account paused.
 *   2. profiles.profile_visibility = 'private' — the primitive that removes
 *      the user from /api/social/search + every leaderboard query (same
 *      column PATCH /api/user/profile-visibility writes). This is what makes
 *      "hidden from leaderboards and search" true server-side.
 *
 * Returns { ok: true }.
 *
 * ── Reversal ──
 * Logging back in clears deactivated_at: lib/auth.tsx syncProfile() upserts
 * the profile on first load after a SIGNED_IN event, and now writes
 * deactivated_at: null in that upsert. So the next successful login
 * reactivates the account automatically. (Visibility is intentionally NOT
 * auto-restored — the user chose private on the way out and can flip it back
 * in Settings > Privacy whenever they like; silently re-publicizing on login
 * would be surprising.)
 *
 * Auth: requireAuth. Acts only on auth.userId — no body-trusted id.
 * Demo user: BLOCKED — the shared fixture must stay visible + active.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (isDemoUser(auth.userId)) return demoBlockedResponse();

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      deactivated_at: new Date().toISOString(),
      profile_visibility: "private",
    })
    .eq("id", auth.userId);

  if (error) {
    console.error("[api/user/account/deactivate]", error.message);
    return NextResponse.json({ error: "Failed to deactivate account" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
