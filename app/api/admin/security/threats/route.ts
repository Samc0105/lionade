/**
 * GET /api/admin/security/threats  — admin-only ranked offender list.
 * ============================================================================
 * Aggregates security_events over the last ~6 hours into a per-IP threat board:
 * one row per offending IP with a blended score, the set of categories it has
 * triggered, an event count, the last time it was seen, and a sample path/UA.
 * Each IP is flagged blocked when it is on the active ip_denylist.
 *
 * Scoring: each category carries a weight (scanner/bruteforce are highest, then
 * enumeration/admin_probe, then bot/flood, then the rest). An IP's score is the
 * sum over its events of (category weight x event.count), capped per row so a
 * single noisy IP cannot dominate the chart. Sorted descending, top ~50.
 *
 * Service-role only; admin-gated. Generic errors; detail to console.error.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_TAG = "admin/security/threats";

/** Lookback window for the offender aggregation. */
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
/** Hard cap on rows scanned so a flood cannot blow up the aggregation. */
const MAX_EVENTS_SCANNED = 5000;
/** Number of offenders returned to the UI. */
const TOP_N = 50;
/** Per-IP score ceiling so one noisy IP cannot dominate the board. */
const SCORE_CAP = 1000;

type Category =
  | "scanner"
  | "bruteforce"
  | "enumeration"
  | "bot"
  | "flood"
  | "denylist_hit"
  | "auth_failure"
  | "admin_probe";

/** Category weights. Higher = more serious. */
const CATEGORY_WEIGHT: Record<Category, number> = {
  scanner: 10,
  bruteforce: 10,
  enumeration: 6,
  admin_probe: 6,
  bot: 3,
  flood: 3,
  denylist_hit: 4,
  auth_failure: 2,
};

function weightFor(category: string): number {
  return (CATEGORY_WEIGHT as Record<string, number>)[category] ?? 1;
}

/** Raw event row shape from security_events. */
type EventRow = {
  ip: unknown;
  category: unknown;
  count: unknown;
  observed_at: unknown;
  path: unknown;
  user_agent: unknown;
};

type Threat = {
  ip: string;
  score: number;
  categories: string[];
  events: number;
  lastSeen: string;
  samplePath?: string;
  sampleUa?: string;
  blocked: boolean;
};

/** Mutable accumulator while we fold events per IP. */
type Acc = {
  ip: string;
  score: number;
  categories: Set<string>;
  events: number;
  lastSeenMs: number;
  samplePath?: string;
  sampleUa?: string;
  /** Weight of the category that contributed the current sample, so a more
   *  serious category's path/UA wins over a noisier-but-tamer one. */
  sampleWeight: number;
};

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  try {
    const sinceIso = new Date(Date.now() - LOOKBACK_MS).toISOString();

    // NOTE (documented Supabase-type gap): untyped .from() — columns match the
    // security_events table in the security_monitoring migration exactly.
    const eventsRes = await supabaseAdmin
      .from("security_events")
      .select("ip, category, count, observed_at, path, user_agent")
      .gte("observed_at", sinceIso)
      .order("observed_at", { ascending: false })
      .limit(MAX_EVENTS_SCANNED);

    if (eventsRes.error) {
      console.error(`[${ROUTE_TAG}] events`, eventsRes.error.message);
      return NextResponse.json({ error: "Threats unavailable" }, { status: 500 });
    }

    const byIp = new Map<string, Acc>();

    for (const raw of (eventsRes.data ?? []) as EventRow[]) {
      const ip = typeof raw.ip === "string" ? raw.ip.trim() : "";
      if (ip === "") continue;
      const category = typeof raw.category === "string" ? raw.category : "";
      if (category === "") continue;

      const eventCount = Math.max(1, toInt(raw.count));
      const weight = weightFor(category);
      const observedMs =
        typeof raw.observed_at === "string" ? Date.parse(raw.observed_at) : NaN;

      const acc =
        byIp.get(ip) ??
        ({
          ip,
          score: 0,
          categories: new Set<string>(),
          events: 0,
          lastSeenMs: 0,
          sampleWeight: -1,
        } as Acc);

      acc.score += weight * eventCount;
      acc.categories.add(category);
      acc.events += eventCount;
      if (Number.isFinite(observedMs) && observedMs > acc.lastSeenMs) {
        acc.lastSeenMs = observedMs;
      }

      // Keep a sample path/UA from the most serious category seen for this IP.
      if (weight > acc.sampleWeight) {
        acc.sampleWeight = weight;
        if (typeof raw.path === "string" && raw.path !== "") acc.samplePath = raw.path;
        if (typeof raw.user_agent === "string" && raw.user_agent !== "") {
          acc.sampleUa = raw.user_agent;
        }
      }

      byIp.set(ip, acc);
    }

    if (byIp.size === 0) {
      return NextResponse.json({ threats: [] });
    }

    // Resolve which of these IPs are actively blocked. Bounded by byIp.size.
    const ips = Array.from(byIp.keys());
    const blockedSet = new Set<string>();
    const nowIso = new Date().toISOString();
    const denyRes = await supabaseAdmin
      .from("ip_denylist")
      .select("ip, expires_at")
      .eq("active", true)
      .in("ip", ips);

    if (denyRes.error) {
      // Non-fatal: the board is still useful without the blocked flags. Log and
      // continue with everything reported as not-blocked.
      console.error(`[${ROUTE_TAG}] denylist`, denyRes.error.message);
    } else {
      for (const row of (denyRes.data ?? []) as Array<{ ip?: unknown; expires_at?: unknown }>) {
        if (typeof row.ip !== "string") continue;
        const exp = typeof row.expires_at === "string" ? Date.parse(row.expires_at) : NaN;
        // Active and (no expiry or not yet expired).
        if (!Number.isFinite(exp) || row.expires_at === null || (row.expires_at as string) > nowIso) {
          blockedSet.add(row.ip);
        }
      }
    }

    const threats: Threat[] = Array.from(byIp.values())
      .map((acc) => {
        const t: Threat = {
          ip: acc.ip,
          score: Math.min(SCORE_CAP, acc.score),
          // Sort categories by descending weight so the most serious shows first.
          categories: Array.from(acc.categories).sort(
            (a, b) => weightFor(b) - weightFor(a),
          ),
          events: acc.events,
          lastSeen: new Date(acc.lastSeenMs || Date.now()).toISOString(),
          blocked: blockedSet.has(acc.ip),
        };
        if (acc.samplePath !== undefined) t.samplePath = acc.samplePath;
        if (acc.sampleUa !== undefined) t.sampleUa = acc.sampleUa;
        return t;
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // Tiebreak on recency so equally-scored IPs surface the freshest first.
        return a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0;
      })
      .slice(0, TOP_N);

    return NextResponse.json({ threats });
  } catch (err) {
    console.error(`[${ROUTE_TAG}] unexpected`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Threats unavailable" }, { status: 500 });
  }
}
