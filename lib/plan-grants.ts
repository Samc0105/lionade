// Plan-grant entitlement resolver + helpers (server-only).
//
// ──────────────────────────────────────────────────────────────────────────
// ENTITLEMENT MODEL (see lib/migrations/065_plan_grants.sql for the table)
//
// `profiles.plan` stays the single EFFECTIVE plan every existing reader trusts
// (lib/use-plan.ts isPaid, lib/mastery-plan.ts effectiveTier, save-quiz-results,
// missions, competitive). This module does NOT change those readers. It owns
// the ONE write path that folds two independent sources into profiles.plan:
//
//   effective = highest of [ stripe_baseline , highest ACTIVE grant tier ]
//   tier order: platinum > pro > free
//
// where:
//   stripe_baseline   = (subscription_status === 'active') ? subscription_tier : 'free'
//   active grant      = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
//
// recomputeEffectivePlan(userId) MUST be called after every grant create,
// revoke, expiry sweep, and from the Stripe webhook (after it writes the
// Stripe columns). It is idempotent: it reads the current truth and sets
// profiles.plan to match. An active admin grant is therefore never downgraded
// by a Stripe event, and a real Stripe upgrade still wins if it is higher.
//
// IMPORTANT: service-role only. supabaseAdmin bypasses RLS. There is no
// user-side write path to plan_grants (no INSERT/UPDATE policy in 065).
// ──────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase-server";

export type GrantTier = "pro" | "platinum";
export type EffectivePlan = "free" | "pro" | "platinum";

// Tier order: platinum > pro > free. Numeric rank so "highest" is a max().
const TIER_RANK: Record<EffectivePlan, number> = {
  free: 0,
  pro: 1,
  platinum: 2,
};

/** Returns whichever plan ranks higher (platinum > pro > free). */
function higherPlan(a: EffectivePlan, b: EffectivePlan): EffectivePlan {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/** Narrows an arbitrary string to a known plan, defaulting to 'free'. */
function asPlan(value: string | null | undefined): EffectivePlan {
  return value === "pro" || value === "platinum" ? value : "free";
}

export interface ActiveGrant {
  id: string;
  user_id: string;
  tier: GrantTier;
  expires_at: string | null;
  source: string;
  granted_by: string | null;
  reason: string | null;
  created_at: string;
}

/**
 * The single highest ACTIVE grant for a user, or null when none is active.
 * Active = not revoked AND (lifetime OR not yet expired). When several grants
 * are active we return the highest-tier one (platinum beats pro), tie-broken
 * by most-recent created_at so the returned row is the "best" current grant.
 */
export async function getActiveGrant(userId: string): Promise<ActiveGrant | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("plan_grants")
    .select("id, user_id, tier, expires_at, source, granted_by, reason, created_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[plan-grants] getActiveGrant", error.message);
    throw new Error("active grant lookup failed");
  }

  const rows = (data ?? []) as ActiveGrant[];
  if (rows.length === 0) return null;

  // Highest tier wins; rows are already newest-first so the first match at the
  // top rank is the most recent grant of that tier.
  let best: ActiveGrant | null = null;
  for (const row of rows) {
    if (!best || TIER_RANK[row.tier] > TIER_RANK[best.tier]) {
      best = row;
    }
  }
  return best;
}

/** Active grant as the admin UI consumes it: camelCase + resolved username. */
export interface ActiveGrantDTO {
  id: string;
  tier: GrantTier;
  /** null === lifetime grant. */
  expiresAt: string | null;
  reason: string | null;
  source: string | null;
  /** Username of the staff member who issued it, if resolvable. */
  grantedByUsername: string | null;
  createdAt: string;
}

/**
 * Maps a raw plan_grants row to the camelCase shape the admin card renders,
 * resolving granted_by (a staff profile id) to a username. Pass-through null so
 * callers can forward a "no active grant" result uniformly. This is the ONE
 * server-side mapper every grant endpoint (GET + both POSTs) returns through so
 * the client/route contract has a single shape.
 */
export async function toActiveGrantDTO(
  grant: ActiveGrant | null,
): Promise<ActiveGrantDTO | null> {
  if (!grant) return null;

  let grantedByUsername: string | null = null;
  if (grant.granted_by) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("id", grant.granted_by)
      .single();
    grantedByUsername =
      (data as { username: string | null } | null)?.username ?? null;
  }

  return {
    id: grant.id,
    tier: grant.tier,
    expiresAt: grant.expires_at,
    reason: grant.reason,
    source: grant.source,
    grantedByUsername,
    createdAt: grant.created_at,
  };
}

/**
 * Reconciles Stripe + active grants into profiles.plan. The single source of
 * truth for the effective plan write. Returns the effective plan it set.
 *
 * Reads the Stripe baseline columns (subscription_status / subscription_tier)
 * and the highest active grant, takes the higher of the two, and UPDATEs
 * profiles.plan only when it actually changes (avoids a no-op write + keeps
 * updated_at churn down). Never throws on the "user missing" path beyond the
 * profile read — callers (webhook, cron) treat a missing user as a no-op.
 */
export async function recomputeEffectivePlan(userId: string): Promise<EffectivePlan> {
  // 1. Stripe baseline from profiles.
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("plan, subscription_status, subscription_tier")
    .eq("id", userId)
    .single();

  if (profileErr || !profile) {
    console.error(
      "[plan-grants] recompute profile read",
      profileErr?.message ?? "profile not found",
    );
    throw new Error("effective plan recompute failed (profile read)");
  }

  const p = profile as {
    plan: string | null;
    subscription_status: string | null;
    subscription_tier: string | null;
  };

  const stripeBaseline: EffectivePlan =
    p.subscription_status === "active" ? asPlan(p.subscription_tier) : "free";

  // 2. Highest active grant.
  const grant = await getActiveGrant(userId);
  const grantPlan: EffectivePlan = grant ? grant.tier : "free";

  // 3. Effective = higher of the two.
  const effective = higherPlan(stripeBaseline, grantPlan);

  // 4. Write only on change.
  if (asPlan(p.plan) !== effective) {
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ plan: effective })
      .eq("id", userId);
    if (updateErr) {
      console.error("[plan-grants] recompute write", updateErr.message);
      throw new Error("effective plan recompute failed (write)");
    }
  }

  return effective;
}

export interface CreateGrantInput {
  userId: string;
  tier: GrantTier;
  /** Days until expiry. null/undefined = lifetime grant. */
  durationDays?: number | null;
  /** Staff profile id that issued the grant (nullable). */
  grantedBy?: string | null;
  reason?: string | null;
  /** Grant origin label. Defaults to 'admin'. */
  source?: string;
}

export interface GrantResult {
  effectivePlan: EffectivePlan;
  activeGrant: ActiveGrant | null;
}

/**
 * Inserts a plan grant then recomputes the effective plan. The insert and the
 * recompute are intentionally NOT a transaction: if the recompute fails after
 * the insert, the grant row still exists (and the nightly expire-grants cron +
 * the next webhook will reconcile profiles.plan anyway). We surface the insert
 * error to the caller and only recompute on a clean insert.
 */
export async function createGrant(input: CreateGrantInput): Promise<GrantResult> {
  const { userId, tier, durationDays, grantedBy, reason, source } = input;

  let expiresAt: string | null = null;
  if (durationDays != null) {
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      throw new Error("durationDays must be a positive number or null");
    }
    expiresAt = new Date(Date.now() + durationDays * 86_400_000).toISOString();
  }

  const { error: insertErr } = await supabaseAdmin.from("plan_grants").insert({
    user_id: userId,
    tier,
    expires_at: expiresAt,
    source: source ?? "admin",
    granted_by: grantedBy ?? null,
    reason: reason ?? null,
  });

  if (insertErr) {
    console.error("[plan-grants] createGrant insert", insertErr.message);
    throw new Error("grant insert failed");
  }

  const effectivePlan = await recomputeEffectivePlan(userId);
  const activeGrant = await getActiveGrant(userId);
  return { effectivePlan, activeGrant };
}

/**
 * Soft-revokes every currently-active grant for a user (sets revoked_at), then
 * recomputes the effective plan so they drop to their Stripe baseline (unless
 * a fresh Stripe tier or another active grant still elevates them). Returns the
 * count revoked plus the post-revoke effective state.
 */
export async function revokeActiveGrants(
  userId: string,
  by: string | null,
): Promise<{ revokedCount: number; effectivePlan: EffectivePlan; activeGrant: ActiveGrant | null }> {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("plan_grants")
    .update({ revoked_at: nowIso })
    .eq("user_id", userId)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .select("id");

  if (error) {
    console.error("[plan-grants] revokeActiveGrants", error.message);
    throw new Error("grant revoke failed");
  }

  // `by` is recorded for the audit log by the calling route; the table has no
  // revoked_by column in 065, so we don't write it here. Keeping the param so
  // the route can pass who-did-it without inventing a new helper later.
  void by;

  const revokedCount = (data ?? []).length;
  const effectivePlan = await recomputeEffectivePlan(userId);
  const activeGrant = await getActiveGrant(userId);
  return { revokedCount, effectivePlan, activeGrant };
}
