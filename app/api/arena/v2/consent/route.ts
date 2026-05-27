// Arena V2 — first-duel consent acceptance.
//
// POST: no body. Sets profiles.ghost_consent_at to now() and ensures the
// user has a stable anonymized handle (profiles.ghost_anon_handle) so that
// ghost-match displays stay consistent across sessions even if our wordlists
// change later.
//
// Privacy contract (from project_arena_v2_decisions.md):
//   - Opt-OUT default + first-duel consent modal.
//   - Anonymized-by-default. ghost_show_username stays false on accept.
//   - Under-18 force-anonymized regardless of opt-in (enforced at display
//     layer, not here — birthdate is on profiles).
//
// Hard-gated behind isArenaV2Enabled(). Idempotent: re-calling on an
// already-consented user is a no-op return (so a stale modal click never
// double-writes).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isArenaV2Enabled } from "@/lib/arena-v2/feature-flag";
import { generateAnonHandle } from "@/lib/arena-v2/anon-handle";

export async function POST(req: NextRequest) {
  if (!isArenaV2Enabled()) {
    return NextResponse.json({ error: "Arena V2 disabled" }, { status: 404 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, ghost_consent_at, ghost_anon_handle")
      .eq("id", userId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Already consented? Just return the current state.
    if (profile.ghost_consent_at) {
      return NextResponse.json({
        ghostConsentAt: profile.ghost_consent_at,
        ghostAnonHandle: profile.ghost_anon_handle ?? generateAnonHandle(userId),
        alreadyConsented: true,
      });
    }

    const nowIso = new Date().toISOString();
    const handle = profile.ghost_anon_handle ?? generateAnonHandle(userId);

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        ghost_consent_at: nowIso,
        ghost_anon_handle: handle,
      })
      .eq("id", userId);

    if (error) {
      console.error("[arena/v2/consent] update", error.message);
      return NextResponse.json({ error: "Couldn't save consent" }, { status: 500 });
    }

    return NextResponse.json({
      ghostConsentAt: nowIso,
      ghostAnonHandle: handle,
      alreadyConsented: false,
    });
  } catch (e) {
    console.error("[arena/v2/consent]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
