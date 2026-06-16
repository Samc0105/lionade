/**
 * POST /api/admin/security/denylist/remove  — admin-only IP unblock.
 * ============================================================================
 * Lifts a block by setting ip_denylist.active = false for the given IP. We keep
 * the row (rather than deleting) so the audit trail and history survive and a
 * later re-block can re-activate the same row.
 *
 * This is a POST /remove sub-route, NOT DELETE /[ip], on purpose: an IP (esp.
 * IPv6 with ':' or an embedded '/CIDR') does not round-trip cleanly through a
 * URL path segment. The IP travels in the JSON body instead.
 *
 * Service-role write (node runtime), admin-gated. Audits with verb
 * security_ip_unblock. Generic errors; detail to console.error only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import { writeTeamAudit } from "@/lib/team/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_TAG = "admin/security/denylist/remove";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
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

  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  if (ip === "" || ip.length > 45) {
    return NextResponse.json({ error: "An IP address is required" }, { status: 400 });
  }

  try {
    // Deactivate the block. We do not require the row to exist; an unblock of a
    // never-blocked IP is a no-op success (idempotent), which is the friendliest
    // behavior for the operator.
    // NOTE (documented Supabase-type gap): untyped .from() update — columns
    // match the ip_denylist table exactly.
    const { error } = await supabaseAdmin
      .from("ip_denylist")
      .update({ active: false })
      .eq("ip", ip);

    if (error) {
      console.error(`[${ROUTE_TAG}] unblock`, error.message);
      return NextResponse.json({ error: "Unblock failed" }, { status: 500 });
    }

    await writeTeamAudit(supabaseAdmin, {
      performedBy: staff.userId,
      action: "security_ip_unblock",
      metadata: { ip },
    });

    return NextResponse.json({ ok: true, ip });
  } catch (err) {
    console.error(`[${ROUTE_TAG}] unexpected`, err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Unblock failed" }, { status: 500 });
  }
}
