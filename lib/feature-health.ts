// Server-side feature-HEALTH helper for the WEB-ONLY status / auto-maintenance
// system. Companion to lib/feature-flags.ts (the kill-switch v2).
// ============================================================================
// ⚠️  SERVER-ONLY — imports supabaseAdmin (service role, bypasses RLS).
// Only import in /app/api/* route handlers and other node-runtime server code.
//
// FAIL-OPEN / SAFE is the entire design contract, exactly as for feature-flags:
// nothing in this module may take the site down or block a request path.
//   - recordFeatureError is FIRE-AND-FORGET: it kicks off an insert and returns
//     immediately. It never awaits, never throws, never reads, and never blocks
//     the caller's response. A health-event write failing is a non-event.
//   - openIncident / closeOpenIncidents / getErrorCountsSince are async, but
//     they each swallow every error and never throw to their caller. On failure
//     they degrade silently (a missed incident row or an empty count map) rather
//     than propagating an exception into a handler or a cron.
//   - All logging is generic and tagged "[feature-health]"; no secrets, no
//     Supabase error.message echoed to any response (these are server logs only).
//
// Tables (applied manually in 20260616170000_status_incidents_health.sql):
//   public.feature_health_events(id, feature_key, observed_at)
//     One row per recorded 5xx-class error. Bounded scan window; the evaluator
//     reads only a short recent slice. A future cleanup prunes old rows.
//   public.incidents(id, feature_key, kind 'warning'|'maintenance', message,
//     source 'manual'|'auto', started_at, ended_at, created_at)
//     The incident timeline. An OPEN incident has ended_at IS NULL.

import { supabaseAdmin } from "@/lib/supabase-server";

export type IncidentKind = "warning" | "maintenance";
export type IncidentSource = "manual" | "auto";

/**
 * Fire-and-forget: record one 5xx-class error against a feature key.
 *
 * MUST never throw and never block the caller. We do NOT await the insert; we
 * start the promise and attach a catch so an unhandled rejection can never
 * surface. Call this in a route's 500-class catch path only:
 *
 *   } catch (err) {
 *     recordFeatureError("shop.purchase");
 *     console.error("[shop-purchase]", err instanceof Error ? err.message : "failed");
 *     return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
 *   }
 */
export function recordFeatureError(featureKey: string): void {
  try {
    // NOTE (documented Supabase-type gap): untyped .from() — the
    // feature_health_events table is applied manually
    // (20260616170000_status_incidents_health.sql) and is not in the generated
    // Supabase types. Columns match that migration exactly.
    const result = supabaseAdmin
      .from("feature_health_events")
      .insert({ feature_key: featureKey });

    // Drive the PostgrestBuilder to execution and absorb any rejection. We do
    // not await: the caller's request path is never delayed by this write.
    Promise.resolve(result).catch(() => {
      // Intentionally swallowed: a health-event write failure is a non-event.
    });
  } catch {
    // Even constructing/queuing the insert must never throw into the caller.
  }
}

/**
 * Open an incident for a feature if one is not already open (ended_at IS NULL).
 * Idempotent: a no-op when an open incident already exists for the key, so
 * re-extending an auto-warning does not spawn duplicate rows.
 *
 * Never throws. On any read/write error it logs generically and returns false.
 *
 * Returns TRUE only when a NEW incident row was actually inserted (i.e. there
 * was no open incident before). The auto-maintenance cron dedups its support@
 * email off this return value, so a re-extended auto-warning does not re-email.
 * Returns false when an incident was already open OR on any error (the safe
 * direction: do not email).
 */
export async function openIncident(
  featureKey: string,
  kind: IncidentKind,
  message: string | null,
  source: IncidentSource,
): Promise<boolean> {
  try {
    // Is there already an open incident for this key?
    const { data: existing, error: readError } = await supabaseAdmin
      .from("incidents")
      .select("id")
      .eq("feature_key", featureKey)
      .is("ended_at", null)
      .limit(1);

    if (readError) {
      console.error("[feature-health] openIncident read", readError.message);
      return false;
    }
    if (existing && existing.length > 0) {
      // Already open — idempotent no-op.
      return false;
    }

    const { error: insertError } = await supabaseAdmin
      .from("incidents")
      .insert({
        feature_key: featureKey,
        kind,
        message,
        source,
      });

    if (insertError) {
      console.error(
        "[feature-health] openIncident insert",
        insertError.message,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "[feature-health] openIncident",
      err instanceof Error ? err.message : "failed",
    );
    return false;
  }
}

/**
 * Close every open incident (ended_at IS NULL) for a feature by stamping
 * ended_at = now(). Called when a flag returns to 'live' (manual or auto
 * recovery) so the incident timeline mirrors the flag history.
 *
 * Never throws. Logs generically on error.
 */
export async function closeOpenIncidents(featureKey: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("incidents")
      .update({ ended_at: new Date().toISOString() })
      .eq("feature_key", featureKey)
      .is("ended_at", null);

    if (error) {
      console.error("[feature-health] closeOpenIncidents", error.message);
    }
  } catch (err) {
    console.error(
      "[feature-health] closeOpenIncidents",
      err instanceof Error ? err.message : "failed",
    );
  }
}

/**
 * Count health events per feature_key since an ISO cutoff. Single grouped read
 * over a bounded recent window (the evaluator passes a ~10-minute cutoff).
 *
 * Returns a { featureKey: count } map. Never throws; returns {} on any error.
 */
export async function getErrorCountsSince(
  sinceIso: string,
): Promise<Record<string, number>> {
  try {
    // We select only the feature_key column over the recent window and tally in
    // JS. This is a single bounded scan (the cutoff keeps it small) and avoids
    // depending on a Postgres aggregate RPC that is not in the generated types.
    const { data, error } = await supabaseAdmin
      .from("feature_health_events")
      .select("feature_key")
      .gte("observed_at", sinceIso);

    if (error) {
      console.error("[feature-health] getErrorCountsSince", error.message);
      return {};
    }

    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as Array<{ feature_key?: unknown }>) {
      if (typeof row.feature_key !== "string") continue;
      counts[row.feature_key] = (counts[row.feature_key] ?? 0) + 1;
    }
    return counts;
  } catch (err) {
    console.error(
      "[feature-health] getErrorCountsSince",
      err instanceof Error ? err.message : "failed",
    );
    return {};
  }
}
