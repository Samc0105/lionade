/**
 * INTERNAL TELEMETRY INGEST  (node runtime, service-role)
 * ============================================================================
 * WHY THIS EXISTS: the edge middleware runs on the Edge runtime and must NEVER
 * touch the Supabase service role (no node crypto, no supabaseAdmin). So the
 * middleware buffers traffic rollups + security events and POSTs them here,
 * where the node runtime safely holds the service role and writes the DB.
 *
 * Guard: header `x-internal-secret` must equal process.env.INTERNAL_TELEMETRY_SECRET
 * (a SERVER-side edge secret, never NEXT_PUBLIC_*, never shipped to the browser).
 * Compared in constant time. Env unset -> 503. Mismatch / wrong length -> 401.
 *
 * Body: { bucketMinute: ISO-string, rollups: TelemetryRollupRow[], events: SecurityEventInput[] }
 *   - rollups -> RPC ingest_telemetry_rollup (ATOMIC per-bucket increment upsert)
 *   - events  -> bulk insert into security_events
 *
 * This handler NEVER throws to the caller and never echoes Supabase detail.
 * 204 on success, generic 500 on failure (real detail only to console.error).
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import type {
  TelemetryRollupRow,
  SecurityEventInput,
} from "@/lib/security/signatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_TAG = "internal/telemetry";

/** Decision values accepted by request_telemetry_rollup.decision. */
const DECISIONS = new Set<TelemetryRollupRow["decision"]>([
  "allow",
  "block",
  "denylist",
]);

/** Categories accepted by security_events.category. */
const CATEGORIES = new Set<SecurityEventInput["category"]>([
  "scanner",
  "bruteforce",
  "enumeration",
  "bot",
  "flood",
  "denylist_hit",
  "auth_failure",
  "admin_probe",
]);

/** Hard caps so a single flush can never blow up a write. */
const MAX_ROLLUPS = 2000;
const MAX_EVENTS = 1000;

/**
 * Constant-time secret check.
 *   - returns "unset"    when the env secret is not configured (-> 503)
 *   - returns "ok"       when the provided header matches
 *   - returns "mismatch" otherwise (wrong value OR wrong length) (-> 401)
 * Never logs or echoes either secret.
 */
function checkInternalSecret(provided: string | null): "unset" | "ok" | "mismatch" {
  const expected = process.env.INTERNAL_TELEMETRY_SECRET;
  if (!expected) return "unset";
  if (provided === null) return "mismatch";

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch, so length-check first. Lengths
  // are not secret; the comparison of equal-length contents is constant time.
  if (a.length !== b.length) return "mismatch";
  return timingSafeEqual(a, b) ? "ok" : "mismatch";
}

/** Shape of one rollup row as it goes into the RPC's p_rows jsonb. */
type RpcRollupRow = {
  bucket_minute: string;
  key_prefix: string;
  decision: TelemetryRollupRow["decision"];
  count: number;
};

/** Shape of one security_events insert row. */
type SecurityEventRow = {
  ip: string;
  category: SecurityEventInput["category"];
  severity: number;
  path: string | null;
  method: string | null;
  user_agent: string | null;
  detail: Record<string, unknown>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Validate + normalize the bucketMinute into an ISO string. */
function normalizeBucketMinute(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/** Coerce + validate the rollups array into RPC rows. Drops malformed entries. */
function buildRollupRows(raw: unknown, bucketMinute: string): RpcRollupRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RpcRollupRow[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ROLLUPS) break;
    if (!isObject(item)) continue;

    const decision = item.decision;
    if (typeof decision !== "string" || !DECISIONS.has(decision as TelemetryRollupRow["decision"])) {
      continue;
    }

    const keyPrefixRaw = typeof item.key_prefix === "string" ? item.key_prefix.trim() : "";
    const key_prefix = keyPrefixRaw === "" ? "unmatched" : keyPrefixRaw.slice(0, 64);

    const countRaw = typeof item.count === "number" ? item.count : Number(item.count);
    const count = Number.isFinite(countRaw) ? Math.max(0, Math.trunc(countRaw)) : 0;
    if (count <= 0) continue;

    out.push({
      bucket_minute: bucketMinute,
      key_prefix,
      decision: decision as TelemetryRollupRow["decision"],
      count,
    });
  }
  return out;
}

/** Coerce + validate the events array into insert rows. Drops malformed entries. */
function buildEventRows(raw: unknown): SecurityEventRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SecurityEventRow[] = [];
  for (const item of raw) {
    if (out.length >= MAX_EVENTS) break;
    if (!isObject(item)) continue;

    const ip = typeof item.ip === "string" ? item.ip.trim() : "";
    if (ip === "") continue;

    const category = item.category;
    if (typeof category !== "string" || !CATEGORIES.has(category as SecurityEventInput["category"])) {
      continue;
    }

    const sevRaw = typeof item.severity === "number" ? item.severity : Number(item.severity);
    const severity = Number.isFinite(sevRaw) ? Math.min(10, Math.max(1, Math.trunc(sevRaw))) : 1;

    const path = typeof item.path === "string" ? item.path.slice(0, 1024) : null;
    const method = typeof item.method === "string" ? item.method.slice(0, 16) : null;
    const user_agent = typeof item.user_agent === "string" ? item.user_agent.slice(0, 1024) : null;
    const detail = isObject(item.detail) ? item.detail : {};

    out.push({
      ip: ip.slice(0, 64),
      category: category as SecurityEventInput["category"],
      severity,
      path,
      method,
      user_agent,
      detail,
    });
  }
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // --- Guard: internal secret (constant-time) ---------------------------------
  const guard = checkInternalSecret(req.headers.get("x-internal-secret"));
  if (guard === "unset") {
    // Secret not configured: telemetry ingest is effectively disabled. The
    // middleware treats 503 here as "drop this flush and retry later".
    return new NextResponse(null, { status: 503 });
  }
  if (guard === "mismatch") {
    return new NextResponse(null, { status: 401 });
  }

  // --- Parse body -------------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Malformed JSON. Generic 400; nothing sensitive to log.
    return new NextResponse(null, { status: 400 });
  }
  if (!isObject(body)) {
    return new NextResponse(null, { status: 400 });
  }

  const bucketMinute = normalizeBucketMinute(body.bucketMinute);
  if (bucketMinute === null) {
    return new NextResponse(null, { status: 400 });
  }

  const rollupRows = buildRollupRows(body.rollups, bucketMinute);
  const eventRows = buildEventRows(body.events);

  // Nothing valid to write: still a success from the caller's perspective.
  if (rollupRows.length === 0 && eventRows.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  // --- Persist (service role; node runtime) -----------------------------------
  // Both writes are wrapped so we never throw to the caller. Real errors go to
  // console.error only; the response body is always generic.
  try {
    let failed = false;

    if (rollupRows.length > 0) {
      // NOTE (documented Supabase-type gap): supabaseAdmin is constructed
      // without a generated Database generic, so .rpc() accepts this function
      // name + args untyped. The RPC shape is pinned by the migration:
      // ingest_telemetry_rollup(p_rows jsonb) with element
      // {bucket_minute, key_prefix, decision, count}.
      const { error } = await supabaseAdmin.rpc("ingest_telemetry_rollup", {
        p_rows: rollupRows,
      });
      if (error) {
        console.error(`[${ROUTE_TAG}] rollup rpc`, error.message);
        failed = true;
      }
    }

    if (eventRows.length > 0) {
      // Untyped .from() insert (same documented type gap). Columns match the
      // security_events table in the migration exactly.
      const { error } = await supabaseAdmin.from("security_events").insert(eventRows);
      if (error) {
        console.error(`[${ROUTE_TAG}] events insert`, error.message);
        failed = true;
      }
    }

    if (failed) {
      return new NextResponse(null, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    // Defensive: any unexpected throw (e.g. transport error) stays internal.
    console.error(`[${ROUTE_TAG}] unexpected`, err instanceof Error ? err.message : "unknown");
    return new NextResponse(null, { status: 500 });
  }
}
