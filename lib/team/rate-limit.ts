// Provisioning rate limit for team management (server-only).
//
// Provisioning is the most dangerous team action: each call mints a real
// Supabase account + a temporary credential. A compromised or buggy admin
// session should not be able to spray-create accounts. We cap each admin to
// 10 provisions per rolling hour.
//
// We piggyback on admin_audit_log instead of a dedicated counter table: every
// successful provision already writes a `team_provision` row (audit is mandatory),
// so the log IS the rate-limit source of truth. No extra schema, no drift between
// "what happened" and "what we counted". The window is the trailing 60 minutes
// from `now`, computed in the query — not a fixed clock bucket — so there's no
// burst-at-the-boundary loophole.

import type { SupabaseClient } from "@supabase/supabase-js";

const PROVISION_ACTION = "team_provision";
const MAX_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Error carrying an HTTP status so the route can map it straight to a response
 * without re-deriving the code. 429 = Too Many Requests.
 */
export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Throws RateLimitError (status 429) if `adminProfileId` has already performed
 * MAX_PER_HOUR `team_provision` actions in the trailing hour. Otherwise resolves.
 *
 * Call this BEFORE provisioning (the gate), not after. A DB read failure FAILS
 * CLOSED — if we can't verify the count we refuse the action rather than allow an
 * unbounded one, because the cost of a wrongly-blocked provision (retry later) is
 * far lower than the cost of an unbounded account-creation loop.
 */
export async function assertProvisionRateLimit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js
  // generic Database type isn't generated in this project; the default client is
  // untyped. This is the unavoidable Supabase-type gap (see lib/team/audit.ts).
  supabaseAdmin: SupabaseClient<any, "public", any>,
  adminProfileId: string,
): Promise<void> {
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();

  const { count, error } = await supabaseAdmin
    .from("admin_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", PROVISION_ACTION)
    .eq("performed_by", adminProfileId)
    .gte("created_at", sinceIso);

  if (error) {
    console.error("[team-rate-limit] count query failed:", error.message);
    // Fail closed: deny rather than allow an unverified provision.
    throw new RateLimitError("Could not verify provisioning rate limit. Try again shortly.", 60);
  }

  if ((count ?? 0) >= MAX_PER_HOUR) {
    throw new RateLimitError(
      `Provisioning limit reached (${MAX_PER_HOUR} per hour). Try again later.`,
      Math.ceil(WINDOW_MS / 1000),
    );
  }
}
