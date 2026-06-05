/**
 * PATCH /api/user/profile-visibility
 *
 * P0 trust-gap fix 2026-06-05.
 *
 * Body: { visibility: "public" | "private" }
 *
 * Writes the dedicated profiles.profile_visibility column (migration
 * 20260605142539_trust_gaps_visibility_prefs.sql). This is the column
 * that /api/social/search and lib/db.ts:getLadderLeaderboard /
 * getEloLeaderboard / getLeaderboard filter on. Setting "private" here
 * is THE primitive that makes the user disappear from public discovery.
 *
 * Notification + show-on-leaderboard sub-flags (which a user might also
 * toggle in the Privacy section) live in profiles.preferences JSONB and
 * are written via /api/user/preferences instead.
 *
 * Demo user is allowed to change their own visibility — it doesn't
 * affect any real-money or shared state, and being able to test the
 * private-mode UX is useful.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["public", "private"]);

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: { visibility?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const v = typeof body.visibility === "string" ? body.visibility : "";
  if (!ALLOWED.has(v)) {
    return NextResponse.json(
      { error: "visibility must be 'public' or 'private'" },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ profile_visibility: v })
    .eq("id", auth.userId);

  if (error) {
    console.error("[api/user/profile-visibility]", error.message);
    return NextResponse.json({ error: "Failed to update visibility" }, { status: 500 });
  }

  return NextResponse.json({ profile_visibility: v });
}
