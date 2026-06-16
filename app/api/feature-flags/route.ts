/**
 * /api/feature-flags  — PUBLIC read of the maintenance / kill-switch state.
 * ============================================================================
 *   GET — returns { flags: { <key>: { status, message, eta } } } for every
 *         overridden feature key. NO AUTH: clients poll this to render
 *         maintenance screens; it carries no sensitive data (only what an
 *         operator has chosen to show users) and is covered by the middleware
 *         catch-all rate limit.
 *
 * Reads go through the SERVICE ROLE (anon is revoked on feature_flags), via the
 * cached helper. FAIL-OPEN: on ANY error we return { flags: {} } — an empty map
 * means no overrides, which the client treats as "everything is live". A
 * maintenance system must never itself take the site down.
 */

import { NextResponse } from "next/server";
import { getFeatureFlagsCached } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const flags = await getFeatureFlagsCached();
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
