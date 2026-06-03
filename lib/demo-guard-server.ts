/**
 * Server-only demo guard helper. Returns the canonical 403 response we
 * surface to the client when the demo account attempts a blocked action.
 *
 * Split from lib/demo-guard.ts so that file (which exports the UUID +
 * isDemoUser predicate) stays safe to import from client bundles without
 * pulling in next/server.
 *
 * Usage in a route handler:
 *
 *   import { requireAuth } from "@/lib/api-auth";
 *   import { isDemoUser } from "@/lib/demo-guard";
 *   import { demoBlockedResponse } from "@/lib/demo-guard-server";
 *
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;
 *   if (isDemoUser(auth.userId)) return demoBlockedResponse();
 */

import { NextResponse } from "next/server";

/**
 * Friendly 403 response for actions the demo account isn't allowed to
 * perform. The trailing "Sign up to try it for real." line is meant for
 * frontends to surface as-is (or to pattern-match against if they want a
 * dedicated CTA).
 */
export function demoBlockedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Demo accounts can't do that. Sign up to try it for real." },
    { status: 403 },
  );
}
