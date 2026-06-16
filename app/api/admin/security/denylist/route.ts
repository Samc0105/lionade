/**
 * /api/admin/security/denylist  — admin-only IP block list management.
 * ============================================================================
 *   GET  — list every denylist entry (active + inactive) with the blocking
 *          admin's display name resolved for the UI.
 *   POST — add (or re-activate) a block for an IP. Validates the IP shape,
 *          upserts active = true, then audits with verb security_ip_block.
 *
 * The edge middleware reads the ACTIVE subset of this table on a TTL via
 * /api/internal/denylist. Writes here hold the service role (node runtime).
 * Admin-gated; generic errors; detail to console.error only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import { writeTeamAudit } from "@/lib/team/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_TAG = "admin/security/denylist";

const MAX_REASON_LEN = 280;

/**
 * Conservative IPv4 / IPv6 shape check. We are validating an operator-supplied
 * string, not parsing for routing, so the goal is "looks like an IP, not a
 * hostname / glob / injection" rather than full RFC compliance.
 */
function looksLikeIp(value: string): boolean {
  const v = value.trim();
  if (v === "" || v.length > 45) return false;

  // IPv4: four 0-255 octets.
  const ipv4 =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  if (ipv4.test(v)) return true;

  // IPv6: hex groups + ':' (allow '::' compression and an embedded IPv4 tail).
  // Deliberately permissive within the IPv6 alphabet; rejects anything with a
  // character outside [0-9a-f:.].
  if (/^[0-9a-f:.]+$/i.test(v) && v.includes(":")) {
    // Must have at least two groups and not be a lone ':'.
    const groups = v.split(":");
    if (groups.length >= 2 && groups.length <= 8) return true;
  }

  return false;
}

/** Normalize a parsed expiresAt into an ISO string, or null. Rejects past. */
function normalizeExpiresAt(raw: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, iso: null };
  if (typeof raw !== "string") return { ok: false };
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return { ok: false };
  // An expiry in the past would create a block that is dead on arrival; reject
  // so the operator gets a clear 400 rather than a silently inert entry.
  if (ms <= Date.now()) return { ok: false };
  return { ok: true, iso: new Date(ms).toISOString() };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Raw denylist row + the joined profile name. */
type DenyRow = {
  ip: unknown;
  reason: unknown;
  active: unknown;
  created_at: unknown;
  expires_at: unknown;
  blocked_by: unknown;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  try {
    // NOTE (documented Supabase-type gap): untyped .from() — columns match the
    // ip_denylist table in the security_monitoring migration exactly.
    const listRes = await supabaseAdmin
      .from("ip_denylist")
      .select("ip, reason, active, created_at, expires_at, blocked_by")
      .order("created_at", { ascending: false });

    if (listRes.error) {
      console.error(`[${ROUTE_TAG}] list`, listRes.error.message);
      return NextResponse.json({ error: "Denylist unavailable" }, { status: 500 });
    }

    const rows = (listRes.data ?? []) as DenyRow[];

    // Resolve blocking-admin names in one batched lookup (bounded by row count).
    const blockerIds = Array.from(
      new Set(
        rows
          .map((r) => (typeof r.blocked_by === "string" ? r.blocked_by : null))
          .filter((id): id is string => id !== null),
      ),
    );

    const nameById = new Map<string, string>();
    if (blockerIds.length > 0) {
      const profRes = await supabaseAdmin
        .from("profiles")
        .select("id, display_name, username")
        .in("id", blockerIds);
      if (profRes.error) {
        // Non-fatal: names are cosmetic. Log and fall back to null below.
        console.error(`[${ROUTE_TAG}] blocker names`, profRes.error.message);
      } else {
        for (const p of (profRes.data ?? []) as Array<{
          id?: unknown;
          display_name?: unknown;
          username?: unknown;
        }>) {
          if (typeof p.id !== "string") continue;
          const name =
            (typeof p.display_name === "string" && p.display_name.trim() !== ""
              ? p.display_name
              : typeof p.username === "string"
                ? p.username
                : null) ?? null;
          if (name) nameById.set(p.id, name);
        }
      }
    }

    const entries = rows.map((r) => ({
      ip: typeof r.ip === "string" ? r.ip : "",
      reason: typeof r.reason === "string" ? r.reason : null,
      blockedByName:
        typeof r.blocked_by === "string" ? nameById.get(r.blocked_by) ?? null : null,
      active: r.active === true,
      createdAt: typeof r.created_at === "string" ? r.created_at : null,
      expiresAt: typeof r.expires_at === "string" ? r.expires_at : null,
    }));

    return NextResponse.json({ entries });
  } catch (err) {
    console.error(`[${ROUTE_TAG}] unexpected`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Denylist unavailable" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!isObject(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const ipRaw = typeof body.ip === "string" ? body.ip.trim() : "";
  if (!looksLikeIp(ipRaw)) {
    return NextResponse.json({ error: "A valid IP address is required" }, { status: 400 });
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim() !== ""
      ? body.reason.trim().slice(0, MAX_REASON_LEN)
      : null;

  const expiry = normalizeExpiresAt(body.expiresAt);
  if (!expiry.ok) {
    return NextResponse.json({ error: "expiresAt must be a future date" }, { status: 400 });
  }

  try {
    // Upsert on the ip primary key: a fresh block or a re-activation of a
    // previously lifted one. active is forced true; created_at refreshes so the
    // list orders the re-block to the top.
    // NOTE (documented Supabase-type gap): untyped .from() upsert — columns
    // match the ip_denylist table exactly.
    const { error } = await supabaseAdmin
      .from("ip_denylist")
      .upsert(
        {
          ip: ipRaw,
          reason,
          blocked_by: staff.userId,
          active: true,
          created_at: new Date().toISOString(),
          expires_at: expiry.iso,
        },
        { onConflict: "ip" },
      );

    if (error) {
      console.error(`[${ROUTE_TAG}] block`, error.message);
      return NextResponse.json({ error: "Block failed" }, { status: 500 });
    }

    // Audit AFTER the mutation succeeds. Fire the verb documented in the
    // security_monitoring migration header.
    await writeTeamAudit(supabaseAdmin, {
      performedBy: staff.userId,
      action: "security_ip_block",
      metadata: { ip: ipRaw, reason, expiresAt: expiry.iso },
    });

    return NextResponse.json({ ok: true, ip: ipRaw }, { status: 201 });
  } catch (err) {
    console.error(`[${ROUTE_TAG}] unexpected`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Block failed" }, { status: 500 });
  }
}
