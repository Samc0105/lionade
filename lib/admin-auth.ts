// Role-gated auth for the Admin Console (/api/admin/* routes).
//
// Roles live on profiles.role ('user' | 'support' | 'admin', migration 057).
// The role hierarchy is admin > support > user. Page-level gating in
// app/admin/layout.tsx is UX only — THIS is the security boundary. Every
// /api/admin/* route must start with:
//
//   const staff = await requireRole(req, "support");   // or "admin"
//   if (staff instanceof NextResponse) return staff;    // 401 / 403
//
// Support staff get read access + non-destructive actions (password resets).
// Destructive actions (Fang adjustments, role changes, suspensions, raw
// email reveal) require "admin".
//
// Until migration 057 runs, the role column doesn't exist; getUserRole
// swallows that error and reports 'user', so the console stays sealed.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-server";
import { getAuthedUser } from "./api-auth";
import type { SecurityEventInput } from "./security/signatures";

export type AppRole = "user" | "support" | "admin";

/** Extracts the client IP from proxy headers (x-forwarded-for / x-real-ip). */
function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

/**
 * Fire-and-forget write to security_events. Feeds the security dashboard's
 * brute-force / admin-probe view with the 401/403 signals the edge middleware
 * structurally cannot observe (those decisions happen inside node handlers).
 *
 * MUST NEVER throw and MUST NEVER be awaited on a happy path — call it only on
 * a failure branch and let the promise settle in the background. Swallows all
 * errors (telemetry must never affect the request's outcome or latency).
 *
 * Untyped .from() insert — the security_events table is not yet in the
 * generated Supabase types (migration 20260616140000_security_monitoring.sql,
 * applied manually). Columns match that table exactly. This is the one
 * documented Supabase-type gap.
 */
export function recordSecurityEvent(input: SecurityEventInput): void {
  const row = {
    ip: input.ip,
    category: input.category,
    severity: input.severity ?? 1,
    path: input.path ?? null,
    method: input.method ?? null,
    user_agent: input.user_agent ?? null,
    detail: input.detail ?? {},
  };
  void supabaseAdmin
    .from("security_events")
    .insert(row)
    .then(({ error }) => {
      if (error) console.error("[security-event]", error.message);
    })
    .then(undefined, () => {
      // Network / unexpected rejection — telemetry is best-effort only.
    });
}

export interface StaffUser {
  userId: string;
  email: string | null;
  role: AppRole;
}

/** True when `role` satisfies `minRole` (admin satisfies everything). */
export function roleSatisfies(role: AppRole, minRole: "support" | "admin"): boolean {
  if (role === "admin") return true;
  return role === "support" && minRole === "support";
}

/** Reads the caller's role from profiles. Fails closed to 'user'. */
export async function getUserRole(userId: string): Promise<AppRole> {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (error || !data) return "user";
    const role = (data as { role?: string }).role;
    return role === "admin" || role === "support" ? role : "user";
  } catch {
    return "user";
  }
}

/**
 * Returns the authenticated staff member, or a ready-to-return NextResponse
 * (401 when unauthenticated, 403 when the role is insufficient).
 */
export async function requireRole(
  req: NextRequest,
  minRole: "support" | "admin",
): Promise<StaffUser | NextResponse> {
  const user = await getAuthedUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = await getUserRole(user.userId);
  if (!roleSatisfies(role, minRole)) {
    // Authenticated user reaching an admin surface they lack the role for is a
    // probe signal middleware can't see. Fire-and-forget only on this failure
    // branch; never awaited, never blocks the 403, never throws.
    recordSecurityEvent({
      ip: clientIp(req) ?? "unknown",
      category: "admin_probe",
      severity: 2,
      path: req.nextUrl.pathname,
      method: req.method,
      detail: { required_role: minRole },
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { ...user, role };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict UUID check — every /api/admin/users/[id] route validates with this. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Masks an email for display to staff: "samuel@example.com" → "s•••@e•••com".
 * Raw email is admin-only and audited (GET /api/admin/users/[id]/email).
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot + 1) : "";
  return `${local.slice(0, 1)}•••@${domain.slice(0, 1)}•••${tld}`;
}

/**
 * Appends a row to admin_audit_log. Call AFTER the action succeeds so the
 * log never claims something that didn't happen. Writes go through the
 * service role (bypasses RLS); failures are surfaced to the caller so the
 * route can decide whether to flag them, but they never throw.
 */
export async function logAdminAction(entry: {
  performedBy: string;
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean }> {
  const { error } = await supabaseAdmin.from("admin_audit_log").insert({
    performed_by: entry.performedBy,
    action: entry.action,
    target_user_id: entry.targetUserId ?? null,
    metadata: entry.metadata ?? {},
  });
  if (error) {
    console.error("[admin-audit] insert failed:", error.message, entry.action);
    return { ok: false };
  }
  return { ok: true };
}
