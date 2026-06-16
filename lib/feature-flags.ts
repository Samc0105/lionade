// Server-side feature-flag helper for the WEB-ONLY admin kill-switch (v2).
// ============================================================================
// ⚠️  SERVER-ONLY — imports supabaseAdmin (service role, bypasses RLS).
// Only import in /app/api/* route handlers and other node-runtime server code.
//
// FAIL-OPEN is the entire design contract. A monitoring / maintenance system
// must never itself be able to take the site down. So:
//   - Public reads go through the SERVICE ROLE (anon is revoked on the table).
//   - On ANY read failure (DB error, missing table/column, network) we serve
//     the last known-good cache, or — if we have never read successfully — an
//     empty map. An empty map means "no overrides" which means "everything is
//     live".
//   - A key with NO ROW is live (the safe default, also enforced in the DB).
//
// v2 status model (3 states):
//   'live'         normal operation (the absent-row default).
//   'warning'      feature is STILL USABLE; the app shows a dismissible "known
//                  issue" banner. The API is NOT blocked.
//   'maintenance'  feature is replaced by the maintenance screen; the API 503s.
//
// SCHEDULING WINDOW: each row may carry starts_at / ends_at (timestamptz, both
// nullable). The EFFECTIVE status is window-aware and computed at READ TIME,
// never stored. A 'warning'/'maintenance' row only takes effect inside its
// window; outside it (not yet started, or already ended) it auto-resolves to
// 'live'. This means expiry needs NO cron: the next read clears it.
//
// Recovery surfaces (/admin/*, /login, /signup, /onboard/*, /settings/*, the
// auth/account/quiz-core APIs, the Navbar, the flag system itself) can never be
// gated: no node exists for them in lib/features/catalog.ts, and the admin POST
// route rejects any key not in that catalog. assertFeatureLive only ever gates
// keys the catalog allows.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { featureChain } from "@/lib/features/catalog";

export type RawFeatureStatus = "live" | "warning" | "maintenance";
export type EffectiveFeatureStatus = RawFeatureStatus;

// A RAW flag row as stored: status plus the (nullable) scheduling window.
// startsAt / endsAt are ISO timestamptz strings or null (open-ended).
export interface RawFeatureFlag {
  status: RawFeatureStatus;
  message: string | null;
  eta: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export type FeatureFlagMap = Record<string, RawFeatureFlag>;

// In-process cache. Survives only for the life of a server instance, which is
// exactly the point: it cheaply collapses a burst of requests into one DB read
// while keeping the window for staleness small (~30s).
const CACHE_TTL_MS = 30_000;

let cache: FeatureFlagMap | null = null;
let cacheFetchedAt = 0;
// Coalesce concurrent refreshes so a cold cache under load issues one query.
let inflight: Promise<FeatureFlagMap> | null = null;

function normalizeRawStatus(value: unknown): RawFeatureStatus {
  if (value === "maintenance") return "maintenance";
  if (value === "warning") return "warning";
  return "live";
}

/**
 * EFFECTIVE RESOLUTION — the single source of truth, shared in spirit with the
 * client (which reads pre-resolved values from the public endpoint, so windows
 * are only ever computed here on the server).
 *
 * Given a raw row and the current time:
 *   - status 'live'                 -> 'live'.
 *   - status 'warning'|'maintenance'-> that status ONLY IF the window is open:
 *       (starts_at is null OR now >= starts_at)
 *       AND (ends_at is null OR now <= ends_at)
 *     otherwise 'live' (not yet active, or expired => AUTO-CLEAR).
 *
 * `now` is supplied by the caller (computed at call time) so a whole request's
 * resolution uses one consistent instant. Unparseable bounds fail-open: an
 * invalid starts_at is treated as "no lower bound", an invalid ends_at as
 * "no upper bound", so a malformed timestamp never strengthens a gate.
 */
export function effectiveStatus(
  row: RawFeatureFlag,
  now: number,
): EffectiveFeatureStatus {
  if (row.status === "live") return "live";

  if (row.startsAt !== null) {
    const startsMs = Date.parse(row.startsAt);
    // Valid lower bound and we have not reached it yet => window not active.
    if (!Number.isNaN(startsMs) && now < startsMs) return "live";
  }
  if (row.endsAt !== null) {
    const endsMs = Date.parse(row.endsAt);
    // Valid upper bound and we are past it => window expired (auto-clear).
    if (!Number.isNaN(endsMs) && now > endsMs) return "live";
  }

  return row.status;
}

/**
 * Read all flag rows through the service role. Throws on DB error so the caller
 * can decide whether to serve a stale/empty fail-open value — this function
 * itself never fabricates data. Returns RAW rows (incl the scheduling window);
 * window resolution happens at read time in effectiveStatus().
 */
async function readFlagsFromDb(): Promise<FeatureFlagMap> {
  // NOTE (documented Supabase-type gap): untyped .from() — the feature_flags
  // table is applied manually (20260616150000_feature_flags.sql +
  // 20260616160000_feature_flags_v2.sql) and is not in the generated Supabase
  // types. Columns match those migrations exactly.
  const { data, error } = await supabaseAdmin
    .from("feature_flags")
    .select("key, status, message, eta, starts_at, ends_at");

  if (error) {
    // Surface to the caller; the cache layer turns this into a fail-open result.
    throw new Error(error.message);
  }

  const map: FeatureFlagMap = {};
  for (const row of (data ?? []) as Array<{
    key?: unknown;
    status?: unknown;
    message?: unknown;
    eta?: unknown;
    starts_at?: unknown;
    ends_at?: unknown;
  }>) {
    if (typeof row.key !== "string") continue;
    map[row.key] = {
      status: normalizeRawStatus(row.status),
      message: typeof row.message === "string" ? row.message : null,
      eta: typeof row.eta === "string" ? row.eta : null,
      startsAt: typeof row.starts_at === "string" ? row.starts_at : null,
      endsAt: typeof row.ends_at === "string" ? row.ends_at : null,
    };
  }
  return map;
}

/**
 * Returns the current RAW flag map, served from an in-process cache (~30s TTL).
 *
 * FAIL-OPEN: if the underlying read fails, this returns the last known-good
 * cache when we have one, otherwise an empty map. It never throws and never
 * propagates a DB error to callers — an unreadable flag system must degrade to
 * "everything is live", never to an exception that breaks a request.
 *
 * Callers compute effective (window-aware) status via effectiveStatus().
 */
export async function getFeatureFlagsCached(): Promise<FeatureFlagMap> {
  const now = Date.now();
  if (cache !== null && now - cacheFetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  // Coalesce: if a refresh is already running, await it instead of stampeding.
  if (inflight) {
    try {
      return await inflight;
    } catch {
      // The inflight refresh failed; fall through to the fail-open value below.
      return cache ?? {};
    }
  }

  inflight = (async () => {
    const fresh = await readFlagsFromDb();
    cache = fresh;
    cacheFetchedAt = Date.now();
    return fresh;
  })();

  try {
    return await inflight;
  } catch (err) {
    console.error(
      "[feature-flags]",
      err instanceof Error ? err.message : "read failed",
    );
    // Serve last-good if we have it, otherwise empty (= everything live).
    return cache ?? {};
  } finally {
    inflight = null;
  }
}

/**
 * Drop the cache so the next read hits the DB. Called by the admin POST route
 * after a flag change so an operator sees their toggle take effect promptly.
 */
export function invalidateFeatureFlagCache(): void {
  cache = null;
  cacheFetchedAt = 0;
  inflight = null;
}

/**
 * Server-side gate for a feature key. Resolves the key's full chain (itself
 * plus every dot-path ancestor); if any link's EFFECTIVE status is
 * 'maintenance', returns a ready-to-return 503 NextResponse carrying the
 * offending feature's message and eta. A 'warning' anywhere is NOT a gate
 * (the feature stays usable) so this returns null for warnings.
 *
 * Callsite — place RIGHT AFTER the auth guard:
 *   const m = await assertFeatureLive('games.party.sketch');
 *   if (m) return m;
 *
 * FAIL-OPEN: getFeatureFlagsCached never throws, so an unreadable flag system
 * yields an empty map and this returns null (the feature stays live).
 */
export async function assertFeatureLive(
  key: string,
): Promise<NextResponse | null> {
  const flags = await getFeatureFlagsCached();
  // One consistent instant for the whole chain resolution.
  const now = Date.now();
  for (const link of featureChain(key)) {
    const flag = flags[link];
    if (flag && effectiveStatus(flag, now) === "maintenance") {
      return NextResponse.json(
        {
          error: "This feature is temporarily unavailable.",
          maintenance: {
            feature: link,
            message: flag.message,
            eta: flag.eta,
          },
        },
        { status: 503 },
      );
    }
  }
  return null;
}
