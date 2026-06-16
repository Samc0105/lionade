/**
 * /api/admin/features  — admin-only feature kill-switch management (v2).
 * ============================================================================
 *   GET  — return the full catalog plus every stored RAW flag, so the admin UI
 *          can render the hierarchy AND edit scheduling in one shot:
 *            { catalog: FeatureNode[],
 *              flags: { <key>: { status, message, eta, startsAt, endsAt, updatedAt } } }
 *          Unlike the public endpoint, this returns RAW rows (no window
 *          pre-resolution) so an operator can see and edit the schedule.
 *   POST — upsert one flag (set live / warning / maintenance, optionally with a
 *          user-facing message + eta and a scheduling window), audit it with
 *          verb feature_flag_change, and invalidate the server cache so reads
 *          pick it up promptly.
 *            body: { key, status: 'live'|'warning'|'maintenance',
 *                    message?, eta?, startsAt?: ISO|null, endsAt?: ISO|null }
 *            -> { ok: true }
 *
 * v2 status model: 'live' (normal), 'warning' (usable + dismissible banner, API
 * not blocked), 'maintenance' (maintenance screen + API 503s). The scheduling
 * window (startsAt/endsAt) is stored RAW; effective status is computed at read
 * time (window-aware) by the consumers, never stored here.
 *
 * SAFETY: the POST key MUST exist in FEATURE_CATALOG. The catalog excludes all
 * recovery surfaces (/admin/*, /login, /signup, /onboard/*, /settings/*, the
 * auth/account/quiz-core APIs, the Navbar, the flag system itself) by
 * construction, so a never-gate key cannot be inserted here. Unknown keys are
 * rejected with a 400 before any write.
 *
 * Admin-gated (requireRole 'admin') + trusted-origin on the mutation. Generic
 * error bodies; Supabase detail to console.error only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import { writeTeamAudit } from "@/lib/team/audit";
import { assertTrustedOrigin, UntrustedOriginError } from "@/lib/team/origin-check";
import { invalidateFeatureFlagCache } from "@/lib/feature-flags";
import { FEATURE_CATALOG, getFeature } from "@/lib/features/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_TAG = "admin/features";

const MAX_MESSAGE_LEN = 280;
const MAX_ETA_LEN = 120;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// Sentinel distinguishing "valid but null" from "invalid input" for a window
// bound — null is a legitimate value (open-ended), so we cannot use it to also
// signal a parse failure.
const INVALID_BOUND = Symbol("invalid-window-bound");

/**
 * Normalize a window-bound input to a stored value:
 *   - undefined / null / empty string  -> null  (open-ended bound).
 *   - a parseable date string          -> its canonical ISO string.
 *   - anything else                    -> INVALID_BOUND (caller returns 400).
 * Canonicalizing to ISO keeps stored timestamps consistent regardless of the
 * exact input format the admin UI sends.
 */
function parseWindowBound(value: unknown): string | null | typeof INVALID_BOUND {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return INVALID_BOUND;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return INVALID_BOUND;
  return new Date(ms).toISOString();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  try {
    // NOTE (documented Supabase-type gap): untyped .from() — the feature_flags
    // table is applied manually (20260616150000_feature_flags.sql +
    // 20260616160000_feature_flags_v2.sql) and is not in the generated Supabase
    // types. Columns match those migrations exactly.
    const { data, error } = await supabaseAdmin
      .from("feature_flags")
      .select("key, status, message, eta, starts_at, ends_at, updated_at");

    if (error) {
      console.error(`[${ROUTE_TAG}] list`, error.message);
      return NextResponse.json({ error: "Flags unavailable" }, { status: 500 });
    }

    const flags: Record<
      string,
      {
        status: string;
        message: string | null;
        eta: string | null;
        startsAt: string | null;
        endsAt: string | null;
        updatedAt: string | null;
      }
    > = {};
    for (const row of (data ?? []) as Array<{
      key?: unknown;
      status?: unknown;
      message?: unknown;
      eta?: unknown;
      starts_at?: unknown;
      ends_at?: unknown;
      updated_at?: unknown;
    }>) {
      if (typeof row.key !== "string") continue;
      const rawStatus =
        row.status === "maintenance" || row.status === "warning"
          ? row.status
          : "live";
      flags[row.key] = {
        status: rawStatus,
        message: typeof row.message === "string" ? row.message : null,
        eta: typeof row.eta === "string" ? row.eta : null,
        startsAt: typeof row.starts_at === "string" ? row.starts_at : null,
        endsAt: typeof row.ends_at === "string" ? row.ends_at : null,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      };
    }

    return NextResponse.json({ catalog: FEATURE_CATALOG, flags });
  } catch (err) {
    console.error(`[${ROUTE_TAG}] unexpected`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Flags unavailable" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  try {
    assertTrustedOrigin(req);
  } catch (err) {
    if (err instanceof UntrustedOriginError) {
      return NextResponse.json({ error: "Forbidden" }, { status: err.status });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!isObject(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  // The catalog is the ONLY allow-list. Unknown keys — including every recovery
  // surface, which has no catalog node by construction — are rejected here
  // before any write, so a flag can never lock anyone out of recovery.
  if (!key || !getFeature(key)) {
    return NextResponse.json({ error: "Unknown feature key" }, { status: 400 });
  }

  const status = body.status;
  if (status !== "live" && status !== "warning" && status !== "maintenance") {
    return NextResponse.json(
      { error: "status must be 'live', 'warning' or 'maintenance'" },
      { status: 400 },
    );
  }

  const message =
    typeof body.message === "string" && body.message.trim() !== ""
      ? body.message.trim().slice(0, MAX_MESSAGE_LEN)
      : null;
  const eta =
    typeof body.eta === "string" && body.eta.trim() !== ""
      ? body.eta.trim().slice(0, MAX_ETA_LEN)
      : null;

  // Scheduling window. Each bound is an ISO timestamp string or null
  // (open-ended). null clears the bound; an absent field is also treated as
  // null. A non-empty string that is not a valid date is a 400 — we never store
  // a malformed window. When both bounds are set, ends_at must be after
  // starts_at.
  const startsAt = parseWindowBound(body.startsAt);
  if (startsAt === INVALID_BOUND) {
    return NextResponse.json(
      { error: "startsAt must be an ISO timestamp or null" },
      { status: 400 },
    );
  }
  const endsAt = parseWindowBound(body.endsAt);
  if (endsAt === INVALID_BOUND) {
    return NextResponse.json(
      { error: "endsAt must be an ISO timestamp or null" },
      { status: 400 },
    );
  }
  if (
    startsAt !== null &&
    endsAt !== null &&
    Date.parse(endsAt) <= Date.parse(startsAt)
  ) {
    return NextResponse.json(
      { error: "endsAt must be after startsAt" },
      { status: 400 },
    );
  }

  try {
    // NOTE (documented Supabase-type gap): untyped .from() upsert — columns
    // match the feature_flags table exactly (incl. v2 starts_at / ends_at).
    // updated_at is maintained by the DB trigger on update; on insert it
    // defaults to now().
    const { error } = await supabaseAdmin.from("feature_flags").upsert(
      {
        key,
        status,
        message,
        eta,
        starts_at: startsAt,
        ends_at: endsAt,
        updated_by: staff.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

    if (error) {
      console.error(`[${ROUTE_TAG}] upsert`, error.message);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    // Audit AFTER the mutation succeeds. Verb documented in the migration header.
    await writeTeamAudit(supabaseAdmin, {
      performedBy: staff.userId,
      action: "feature_flag_change",
      metadata: { key, to: status, message, eta, startsAt, endsAt },
    });

    // Drop the in-process cache so the public read and assertFeatureLive pick up
    // the change without waiting out the TTL.
    invalidateFeatureFlagCache();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[${ROUTE_TAG}] unexpected`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
