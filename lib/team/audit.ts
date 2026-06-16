// Team-management audit writer (server-only).
//
// Thin wrapper over the admin_audit_log insert used by every /api/admin/team/*
// route. The table is append-only (DB trigger enforces it), so this is the
// permanent record of who provisioned / offboarded / reset whom.
//
// SECURITY INVARIANT: a credential MUST NEVER reach the audit log. The temporary
// password we mint during provisioning is shown to the admin exactly once; if it
// leaked into admin_audit_log.metadata it would be (a) immutable — the trigger
// blocks DELETE/UPDATE of content, so we could never scrub it — and (b) readable
// by anyone with admin access forever. So this writer actively strips any
// password-like key from metadata before insert, as a last-line guard even if a
// caller is careless. We do NOT just trust callers.

import type { SupabaseClient } from "@supabase/supabase-js";

// Keys that may carry credential material. Matched case-insensitively as a
// substring so "password", "tempPassword", "newPassword", "pwd", "secret",
// "token" etc. are all caught.
const FORBIDDEN_KEY_PATTERNS = ["password", "passwd", "pwd", "secret", "token", "credential"];

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_KEY_PATTERNS.some((pat) => lower.includes(pat));
}

/**
 * Deep-strip any password-like key from a metadata object. Nested objects are
 * recursed; arrays are walked. Returns a sanitized copy — the input is never
 * mutated. Replaces a forbidden key's value with "[REDACTED]" rather than
 * dropping it, so the audit trail records that *something* was scrubbed (which
 * is itself a useful signal that a caller tried to log a secret).
 */
function stripCredentials(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripCredentials(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isForbiddenKey(k) ? "[REDACTED]" : stripCredentials(v);
    }
    return out;
  }
  return value;
}

export interface TeamAuditEntry {
  performedBy: string;
  /** snake_case verb, e.g. team_provision, team_offboard, team_role_change. */
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append a row to admin_audit_log via the service-role client. Call AFTER the
 * action succeeds so the log never claims something that didn't happen. Never
 * throws; returns { ok } so a callsite can flag a failed audit without aborting
 * the (already-completed) main mutation.
 *
 * The `supabaseAdmin` client is passed in (rather than imported) so this stays
 * trivially unit-testable and the dependency is explicit.
 */
export async function writeTeamAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js
  // generic Database type isn't generated in this project; admin_audit_log isn't
  // in a typed schema, so the client is the untyped default. Casting to a typed
  // client here would be a fiction. This is the one unavoidable Supabase-type gap.
  supabaseAdmin: SupabaseClient<any, "public", any>,
  entry: TeamAuditEntry,
): Promise<{ ok: boolean }> {
  const safeMetadata = stripCredentials(entry.metadata ?? {}) as Record<string, unknown>;

  const { error } = await supabaseAdmin.from("admin_audit_log").insert({
    performed_by: entry.performedBy,
    action: entry.action,
    target_user_id: entry.targetUserId ?? null,
    metadata: safeMetadata,
  });

  if (error) {
    // Log the failure server-side only — never echo the metadata (it may have
    // been *intended* to carry sensitive context) and never the raw error to a
    // client. The action string is safe and useful for debugging.
    console.error("[team-audit] insert failed:", error.message, entry.action);
    return { ok: false };
  }
  return { ok: true };
}
