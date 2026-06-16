/**
 * GET /api/admin/security/overview  — admin-only security dashboard summary.
 * ============================================================================
 * Powers the live header of the /admin security console: who is online right
 * now, who was recently active, who is mid-match, and a 60-minute traffic
 * timeseries (total vs blocked) drawn from the IP-free request_telemetry_rollup
 * aggregate.
 *
 * Service-role only. presence_heartbeats RLS is self-only (a user can read only
 * their own row), so the only way to count ALL live sessions is the service
 * role via supabaseAdmin. The admin gate is enforced by requireRole below; the
 * service role is never reachable from the browser.
 *
 * Generic error bodies only; real Supabase detail goes to console.error.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_TAG = "admin/security/overview";

/** Active-match session types tracked in presence_heartbeats.active_session_type. */
const IN_SESSION_TYPES = ["arena_match", "competitive_match"] as const;

/** One point on the 60-minute traffic chart. */
type TrafficPoint = { minute: string; total: number; blocked: number };

/** Raw rollup row as it comes back from request_telemetry_rollup. */
type RollupRow = {
  bucket_minute: unknown;
  decision: unknown;
  count: unknown;
};

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  try {
    const now = Date.now();
    const since60sIso = new Date(now - 60 * 1000).toISOString();
    const since3mIso = new Date(now - 3 * 60 * 1000).toISOString();
    const since60mIso = new Date(now - 60 * 60 * 1000).toISOString();

    // NOTE (documented Supabase-type gap): supabaseAdmin is built without a
    // generated Database generic, so .from(...) selects are untyped. Columns
    // below match presence_heartbeats / profiles / request_telemetry_rollup
    // exactly (see session_lifecycle + admin_console + security_monitoring
    // migrations).
    const [activeNowRes, inSessionRes, recentlyActiveRes, trafficRes] =
      await Promise.all([
        // activeNow — heartbeats pinged in the last 60 seconds.
        supabaseAdmin
          .from("presence_heartbeats")
          .select("user_id", { count: "exact", head: true })
          .gte("last_ping_at", since60sIso),
        // inSession — heartbeats currently inside an arena/competitive match.
        supabaseAdmin
          .from("presence_heartbeats")
          .select("user_id", { count: "exact", head: true })
          .in("active_session_type", IN_SESSION_TYPES as unknown as string[]),
        // recentlyActive — profiles seen in the last 3 minutes.
        supabaseAdmin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .gte("last_seen", since3mIso),
        // traffic — last 60 minutes of the IP-free rollup, summed per minute.
        supabaseAdmin
          .from("request_telemetry_rollup")
          .select("bucket_minute, decision, count")
          .gte("bucket_minute", since60mIso)
          .order("bucket_minute", { ascending: true }),
      ]);

    // If any count query failed, surface a generic 500 (real detail logged).
    if (activeNowRes.error) {
      console.error(`[${ROUTE_TAG}] activeNow`, activeNowRes.error.message);
      return NextResponse.json({ error: "Overview unavailable" }, { status: 500 });
    }
    if (inSessionRes.error) {
      console.error(`[${ROUTE_TAG}] inSession`, inSessionRes.error.message);
      return NextResponse.json({ error: "Overview unavailable" }, { status: 500 });
    }
    if (recentlyActiveRes.error) {
      console.error(`[${ROUTE_TAG}] recentlyActive`, recentlyActiveRes.error.message);
      return NextResponse.json({ error: "Overview unavailable" }, { status: 500 });
    }
    if (trafficRes.error) {
      console.error(`[${ROUTE_TAG}] traffic`, trafficRes.error.message);
      return NextResponse.json({ error: "Overview unavailable" }, { status: 500 });
    }

    const activeNow = activeNowRes.count ?? 0;
    const inSession = inSessionRes.count ?? 0;
    const recentlyActive = recentlyActiveRes.count ?? 0;

    // Fold the rollup rows into per-minute { total, blocked }. We aggregate in
    // JS rather than SQL because PostgREST cannot GROUP BY; the row count is
    // bounded (<= 60 minutes x ~45 prefixes x 3 decisions) so this is cheap.
    const perMinute = new Map<string, { total: number; blocked: number }>();
    let totalRequests = 0;
    let totalBlocked = 0;
    let totalDenylist = 0;

    for (const raw of (trafficRes.data ?? []) as RollupRow[]) {
      const bucketRaw = raw.bucket_minute;
      if (typeof bucketRaw !== "string" && !(bucketRaw instanceof Date)) continue;
      const minuteIso = new Date(bucketRaw as string).toISOString();
      const decision = raw.decision;
      const count = toInt(raw.count);
      if (count <= 0) continue;

      const slot = perMinute.get(minuteIso) ?? { total: 0, blocked: 0 };
      slot.total += count;
      if (decision === "block" || decision === "denylist") {
        slot.blocked += count;
      }
      perMinute.set(minuteIso, slot);

      totalRequests += count;
      if (decision === "block") totalBlocked += count;
      if (decision === "denylist") totalDenylist += count;
    }

    const traffic: TrafficPoint[] = Array.from(perMinute.entries())
      .map(([minute, v]) => ({ minute, total: v.total, blocked: v.blocked }))
      .sort((a, b) => (a.minute < b.minute ? -1 : a.minute > b.minute ? 1 : 0));

    return NextResponse.json({
      activeNow,
      recentlyActive,
      inSession,
      traffic,
      totals: {
        requests: totalRequests,
        // "blocked" total counts edge-blocked requests; denylist hits are
        // reported separately so the UI can distinguish rate-limit blocks from
        // explicit IP bans.
        blocked: totalBlocked,
        denylistHits: totalDenylist,
      },
    });
  } catch (err) {
    console.error(`[${ROUTE_TAG}] unexpected`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Overview unavailable" }, { status: 500 });
  }
}
