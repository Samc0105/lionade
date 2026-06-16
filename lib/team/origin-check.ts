// Trusted-origin check for team-management mutations (server-only).
//
// WHY classic CSRF is structurally N/A here, and why we still do this:
//
//   Lionade's API authenticates exclusively via an `Authorization: Bearer <jwt>`
//   header (see lib/api-auth.ts) — there are NO auth cookies. CSRF, by definition,
//   exploits *ambient* credentials the browser attaches automatically (cookies,
//   HTTP Basic). A cross-site page cannot read another origin's localStorage and
//   cannot set an Authorization header on a cross-origin request without the user
//   explicitly granting it, so a forged cross-site request simply arrives
//   unauthenticated and is rejected by requireRole(). So a CSRF *token* would be
//   pure ceremony here.
//
//   This origin check is therefore DEFENSE IN DEPTH, not the primary control:
//   it cheaply rejects any mutation whose Origin/Referer isn't our own app before
//   we do privileged work, narrowing the blast radius of any future change that
//   accidentally introduces cookie auth, a misconfigured CORS allowance, or a
//   reverse-proxy that forwards stale creds. Belt and suspenders for the most
//   sensitive routes in the product.

import type { NextRequest } from "next/server";

const DEFAULT_ORIGIN = "https://getlionade.com";

/** Error carrying a 403 so the route can map it to a forbidden response. */
export class UntrustedOriginError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "UntrustedOriginError";
  }
}

/**
 * The set of origins we accept. Read at CALL time (not module load) so env
 * changes don't require a redeploy of imported modules and a missing var degrades
 * gracefully to the production domain. localhost dev origins are allowed only
 * when NODE_ENV is not "production".
 */
function allowedOrigins(): Set<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_ORIGIN;
  const origins = new Set<string>();
  try {
    origins.add(new URL(configured).origin);
  } catch {
    // Malformed env value — fall back to the known production origin so the
    // check never silently allows everything.
    origins.add(new URL(DEFAULT_ORIGIN).origin);
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }
  return origins;
}

/**
 * Extract the request's origin from the Origin header, falling back to the
 * scheme+host of the Referer. Returns null if neither is present/parseable.
 */
function requestOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Throws UntrustedOriginError (status 403) if the request's Origin/Referer is
 * absent or not one of our trusted origins. Resolves silently when trusted.
 *
 * FAILS CLOSED: a request with no Origin AND no Referer is rejected. Same-origin
 * fetch() from our own app always sends an Origin header on state-changing
 * methods, so a missing origin on a mutation is anomalous and treated as hostile.
 */
export function assertTrustedOrigin(req: NextRequest): void {
  const reqOrigin = requestOrigin(req);
  if (!reqOrigin) {
    throw new UntrustedOriginError("Request origin could not be verified.");
  }
  if (!allowedOrigins().has(reqOrigin)) {
    throw new UntrustedOriginError("Request origin is not allowed.");
  }
}
