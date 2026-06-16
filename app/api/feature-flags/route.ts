/**
 * /api/feature-flags  — PUBLIC read of the maintenance / kill-switch state.
 * ============================================================================
 *   GET — returns { flags: { <key>: { status, message, eta } } } for every
 *         feature key whose EFFECTIVE status is 'warning' or 'maintenance'.
 *         A missing key means live. NO AUTH: clients poll this to render
 *         maintenance screens / warning banners; it carries no sensitive data
 *         (only what an operator has chosen to show users) and is covered by
 *         the middleware catch-all rate limit.
 *
 * v2: the scheduling WINDOW is PRE-RESOLVED here so clients stay simple — they
 * never recompute windows, they just read the effective status. A windowed
 * 'warning'/'maintenance' row outside its window resolves to 'live' and is
 * therefore omitted from the response (auto-clear, no cron).
 *
 * Reads go through the SERVICE ROLE (anon is revoked on feature_flags), via the
 * cached helper. FAIL-OPEN: on ANY error we return { flags: {} } — an empty map
 * means no overrides, which the client treats as "everything is live". A
 * maintenance system must never itself take the site down.
 */

import { NextResponse } from "next/server";
import { getFeatureFlagsCached, effectiveStatus } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const raw = await getFeatureFlagsCached();
    // One consistent instant for resolving every row's window.
    const now = Date.now();

    const flags: Record<
      string,
      { status: "warning" | "maintenance"; message: string | null; eta: string | null }
    > = {};

    for (const [key, row] of Object.entries(raw)) {
      const effective = effectiveStatus(row, now);
      // Omit live keys (incl. windowed rows not currently active): a missing
      // key means live on the client.
      if (effective === "live") continue;
      flags[key] = {
        status: effective,
        message: row.message,
        eta: row.eta,
      };
    }

    return NextResponse.json({ flags });
  } catch (err) {
    // getFeatureFlagsCached is already fail-open and shouldn't throw, but this
    // is the last line of the same guarantee: never return an error to clients.
    console.error(
      "[feature-flags-route]",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json({ flags: {} });
  }
}
