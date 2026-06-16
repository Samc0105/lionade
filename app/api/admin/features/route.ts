/**
 * /api/admin/features  — admin-only feature kill-switch management.
 * ============================================================================
 *   GET  — return the full catalog plus every stored flag, so the admin UI can
 *          render the hierarchy and current state in one shot:
 *            { catalog: FeatureNode[], flags: { <key>: { status, message, eta, updatedAt } } }
 *   POST — upsert one flag (flip a feature live/maintenance, optionally with a
 *          user-facing message + eta), audit it with verb feature_flag_change,
 *          and invalidate the server cache so reads pick it up promptly.
 *            body: { key, status: 'live'|'maintenance', message?, eta? }
 *            -> { ok: true }
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  try {
    // NOTE (documented Supabase-type gap): untyped .from() — the feature_flags
    // table is applied manually (20260616150000_feature_flags.sql) and is not
    // in the generated Supabase types. Columns match that migration exactly.
    const { data, error } = await supabaseAdmin
      .from("feature_flags")
      .select("key, status, message, eta, updated_at");

    if (error) {
      console.error(`[${ROUTE_TAG}] list`, error.message);
      return NextResponse.json({ error: "Flags unavailable" }, { status: 500 });
    }

    const flags: Record<
      string,
      { status: string; message: string | null; eta: string | null; updatedAt: string | null }
    > = {};
    for (const row of (data ?? []) as Array<{
      key?: unknown;
      status?: unknown;
      message?: unknown;
      eta?: unknown;
      updated_at?: unknown;
    }>) {
      if (typeof row.key !== "string") continue;
      flags[row.key] = {
        status: row.status === "maintenance" ? "maintenance" : "live",
        message: typeof row.message === "string" ? row.message : null,
        eta: typeof row.eta === "string" ? row.eta : null,
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
  if (status !== "live" && status !== "maintenance") {
    return NextResponse.json(
      { error: "status must be 'live' or 'maintenance'" },
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

  try {
    // NOTE (documented Supabase-type gap): untyped .from() upsert — columns
    // match the feature_flags table exactly. updated_at is maintained by the
    // DB trigger on update; on insert it defaults to now().
    const { error } = await supabaseAdmin.from("feature_flags").upsert(
      {
        key,
        status,
        message,
        eta,
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
      metadata: { key, to: status, message, eta },
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
