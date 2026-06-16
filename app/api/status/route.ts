// GET /api/status — PUBLIC, UNAUTHENTICATED status feed for the /status page.
// ============================================================================
// Surfaces the live health of the product to anyone, logged in or not. It is a
// RECOVERY SURFACE: it must always be reachable and must never depend on the
// caller's session, so it has NO auth and reads everything through the service
// role (anon is revoked on the underlying tables). It is the data half of the
// public /status page; the page polls it every ~45s.
//
// SHAPE:
//   {
//     overall: 'operational' | 'degraded',
//     degraded: [{ key, label, status: 'warning'|'maintenance', message, since }],
//     recent:   [{ key, label, kind, message, startedAt, endedAt }]   // resolved
//   }
//   - degraded = every feature whose EFFECTIVE (window-resolved) status is
//     'warning' or 'maintenance' right now. We reuse the exact same window
//     resolution the gate uses (effectiveStatus from lib/feature-flags.ts) so
//     a scheduled or self-expiring flag shows here iff it would actually gate.
//     overall is 'degraded' iff that list is non-empty.
//   - recent = the last ~20 RESOLVED incidents (ended_at set), newest first,
//     for the "recent history" list. Open incidents are represented by the
//     degraded list, not here.
//   - SAFE FIELDS ONLY. No internal detail (no auto flag, no updated_by, no
//     starts/ends bounds, no raw status), just what a visitor needs.
//
// FAIL-OPEN: on ANY error we return { overall:'operational', degraded:[],
// recent:[] }. A status page that can itself report an outage of the status
// system would be worse than useless; an unreadable backend reads as "all good"
// so the page stays calm and reachable. getFeatureFlagsCached already never
// throws; the incidents read is wrapped so a failure just drops the history.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  getFeatureFlagsCached,
  effectiveStatus,
} from "@/lib/feature-flags";
import { getFeature } from "@/lib/features/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_TAG = "status";

// How many resolved incidents to show in the recent-history list.
const RECENT_LIMIT = 20;

interface DegradedEntry {
  key: string;
  label: string;
  status: "warning" | "maintenance";
  message: string | null;
  since: string | null;
}

interface RecentEntry {
  key: string;
  label: string;
  kind: "warning" | "maintenance";
  message: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

interface StatusBody {
  overall: "operational" | "degraded";
  degraded: DegradedEntry[];
  recent: RecentEntry[];
}

const SAFE_FALLBACK: StatusBody = {
  overall: "operational",
  degraded: [],
  recent: [],
};

function labelFor(key: string): string {
  return getFeature(key)?.label ?? key;
}

/**
 * Read the last ~20 RESOLVED incidents (ended_at set), newest first, for the
 * recent-history list. Safe fields only. Returns [] on any error (the page
 * simply shows no history rather than failing). Never throws.
 */
async function readRecentIncidents(): Promise<RecentEntry[]> {
  try {
    // NOTE (documented Supabase-type gap): untyped .from() — the incidents
    // table is applied manually (20260616170000_status_incidents_health.sql)
    // and is not in the generated Supabase types. Columns match that migration.
    const { data, error } = await supabaseAdmin
      .from("incidents")
      .select("feature_key, kind, message, started_at, ended_at")
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(RECENT_LIMIT);

    if (error) {
      console.error(`[${ROUTE_TAG}] incidents read`, error.message);
      return [];
    }

    const out: RecentEntry[] = [];
    for (const row of (data ?? []) as Array<{
      feature_key?: unknown;
      kind?: unknown;
      message?: unknown;
      started_at?: unknown;
      ended_at?: unknown;
    }>) {
      if (typeof row.feature_key !== "string") continue;
      const kind = row.kind === "maintenance" ? "maintenance" : "warning";
      out.push({
        key: row.feature_key,
        label: labelFor(row.feature_key),
        kind,
        message: typeof row.message === "string" ? row.message : null,
        startedAt: typeof row.started_at === "string" ? row.started_at : null,
        endedAt: typeof row.ended_at === "string" ? row.ended_at : null,
      });
    }
    return out;
  } catch (err) {
    console.error(
      `[${ROUTE_TAG}] incidents read`,
      err instanceof Error ? err.message : "unknown",
    );
    return [];
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    // One consistent instant for the whole window resolution.
    const now = Date.now();

    // getFeatureFlagsCached never throws (fail-open => {} on read failure).
    const flags = await getFeatureFlagsCached();

    // Build the degraded list from EFFECTIVE (window-resolved) status, reusing
    // the exact resolution the gate uses so this mirrors reality. We surface the
    // flag's own starts_at as the "since" hint when present (when the override
    // began), else null.
    const degraded: DegradedEntry[] = [];
    for (const [key, flag] of Object.entries(flags)) {
      const eff = effectiveStatus(flag, now);
      if (eff === "warning" || eff === "maintenance") {
        degraded.push({
          key,
          label: labelFor(key),
          status: eff,
          message: flag.message,
          since: flag.startsAt,
        });
      }
    }
    // Maintenance first, then warnings; stable label order within each.
    degraded.sort((a, b) => {
      if (a.status !== b.status) return a.status === "maintenance" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    const recent = await readRecentIncidents();

    const body: StatusBody = {
      overall: degraded.length > 0 ? "degraded" : "operational",
      degraded,
      recent,
    };
    return NextResponse.json(body);
  } catch (err) {
    // Last-resort fail-open: a status feed must never itself error out.
    console.error(
      `[${ROUTE_TAG}] unexpected`,
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json(SAFE_FALLBACK);
  }
}
