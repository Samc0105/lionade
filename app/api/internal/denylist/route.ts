/**
 * INTERNAL DENYLIST READ  (node runtime, service-role)
 * ============================================================================
 * The edge middleware cannot read Supabase (no service role on the Edge
 * runtime). It fetches this tiny endpoint on a TTL to learn which IPs are
 * currently blocked, then enforces the block at the edge.
 *
 * Guard: header `x-internal-secret` must equal process.env.INTERNAL_TELEMETRY_SECRET
 * (server-side edge secret, never NEXT_PUBLIC_*). Constant-time compare.
 * Env unset -> 503. Mismatch / wrong length -> 401.
 *
 * Returns { ips: string[] } of active, non-expired ip_denylist entries:
 *   active = true AND (expires_at IS NULL OR expires_at > now())
 *
 * Never echoes Supabase detail; real errors go to console.error only.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_TAG = "internal/denylist";

/**
 * Constant-time secret check.
 *   - "unset"    -> env secret not configured (-> 503)
 *   - "ok"       -> header matches
 *   - "mismatch" -> wrong value OR wrong length (-> 401)
 */
function checkInternalSecret(provided: string | null): "unset" | "ok" | "mismatch" {
  const expected = process.env.INTERNAL_TELEMETRY_SECRET;
  if (!expected) return "unset";
  if (provided === null) return "mismatch";

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return "mismatch";
  return timingSafeEqual(a, b) ? "ok" : "mismatch";
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // --- Guard: internal secret (constant-time) ---------------------------------
  const guard = checkInternalSecret(req.headers.get("x-internal-secret"));
  if (guard === "unset") {
    return new NextResponse(null, { status: 503 });
  }
  if (guard === "mismatch") {
    return new NextResponse(null, { status: 401 });
  }

  // --- Read active, non-expired blocks (service role; node runtime) -----------
  try {
    const nowIso = new Date().toISOString();
    // NOTE (documented Supabase-type gap): supabaseAdmin has no generated
    // Database generic, so .from("ip_denylist") + .select("ip") are untyped.
    // Columns match the ip_denylist table in the migration.
    const { data, error } = await supabaseAdmin
      .from("ip_denylist")
      .select("ip, expires_at")
      .eq("active", true)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

    if (error) {
      console.error(`[${ROUTE_TAG}] select`, error.message);
      // Fail closed-but-empty: the middleware keeps its last good TTL cache, so
      // returning a generic 500 here just means "do not refresh this cycle".
      return new NextResponse(null, { status: 500 });
    }

    const ips: string[] = [];
    if (Array.isArray(data)) {
      for (const row of data as Array<{ ip?: unknown }>) {
        if (typeof row.ip === "string" && row.ip.trim() !== "") {
          ips.push(row.ip);
        }
      }
    }

    return NextResponse.json({ ips });
  } catch (err) {
    console.error(`[${ROUTE_TAG}] unexpected`, err instanceof Error ? err.message : "unknown");
    return new NextResponse(null, { status: 500 });
  }
}
