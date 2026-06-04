/**
 * GET /api/shop/founder-caps
 *
 * Returns the current count of granted founder badges by badge_id so the
 * shop UI can show a "247 / 1000 left" countdown. Public read (no auth)
 * because the count is a non-sensitive aggregate — exposing it deliberately
 * IS the FOMO mechanic ("only 247 left").
 *
 * Response: { caps: Record<badge_id, { granted: number, cap: number }> }
 *
 * Caps are hardcoded from the shop catalog. Adding a new founder badge
 * requires updating both the catalog AND this route's CAPS map.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// Source of truth for caps. If a badge_id isn't here, it's treated as
// uncapped (won't appear in the response).
const CAPS: Record<string, number> = {
  badge_founding_scholar: 1000, // first 1000 Pro subscribers
  badge_lionade_og: 500,        // first 500 signups
  // badge_beta_witness has no cap — anyone before deploy day qualifies
};

export async function GET() {
  try {
    const badgeIds = Object.keys(CAPS);
    const { data, error } = await supabaseAdmin
      .from("founder_grants")
      .select("badge_id")
      .in("badge_id", badgeIds);

    if (error) {
      console.error("[shop/founder-caps]", error.message);
      // Fall back to empty counts; UI degrades to "Cap of N" static label
      const fallback = Object.fromEntries(
        badgeIds.map((id) => [id, { granted: 0, cap: CAPS[id] }]),
      );
      return NextResponse.json({ caps: fallback });
    }

    // Tally per badge_id
    const counts: Record<string, number> = {};
    for (const id of badgeIds) counts[id] = 0;
    for (const row of data ?? []) {
      const bid = row.badge_id as string;
      counts[bid] = (counts[bid] ?? 0) + 1;
    }

    const caps = Object.fromEntries(
      badgeIds.map((id) => [
        id,
        { granted: counts[id] ?? 0, cap: CAPS[id]! },
      ]),
    );
    return NextResponse.json({ caps });
  } catch (e) {
    console.error("[shop/founder-caps] unexpected", e);
    return NextResponse.json({ caps: {} });
  }
}
