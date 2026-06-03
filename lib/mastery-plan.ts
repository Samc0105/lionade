/**
 * Plan configuration — source of truth for both pricing copy and
 * server-side feature gating. Edit here; pricing page and gating logic
 * both read from these constants so they can't drift.
 */

export const PLAN_EXAM_LIMITS = {
  free: 1,
  pro: 3,
  platinum: 8,
} as const;

export type MasteryPlan = keyof typeof PLAN_EXAM_LIMITS;

// ── Pricing (USD) ────────────────────────────────────────────────────────────
// Monthly + annual (annual = ~2 months free, standard SaaS value prop).
// Stripe fee reference: 2.9% + $0.30 per transaction.
// AI cost reference: ~$3/mo for a Pro user, ~$5/mo for a Platinum user on
// current OpenAI (gpt-4o + gpt-4o-mini) usage.
export const PLAN_PRICING = {
  free: {
    monthly: 0,
    annual: 0,
  },
  pro: {
    monthly: 6.99,
    annual: 69.99,          // $5.83/mo equivalent — ~2 months free
  },
  platinum: {
    monthly: 14.99,
    annual: 149.99,         // $12.50/mo equivalent — ~2 months free
  },
} as const;

// Fangs earn multipliers by plan — encourages upgrade without making free
// unusable.
export const PLAN_FANG_MULTIPLIER = {
  free: 1.0,
  pro: 1.5,
  platinum: 2.0,
} as const;

// ── Ad experience by plan ────────────────────────────────────────────────────
//
// Product decision (2026-04-24): free users see BOTH popup + background
// ads. Pro removes popups (keeps background/banner). Platinum removes all
// ads entirely.
export const PLAN_ADS = {
  free:     { popups: true,  background: true  },
  pro:      { popups: false, background: true  },
  platinum: { popups: false, background: false },
} as const;

export function planLimit(plan: string | null | undefined): number {
  if (plan === "pro" || plan === "platinum") return PLAN_EXAM_LIMITS[plan];
  return PLAN_EXAM_LIMITS.free;
}

export function normalizePlan(plan: string | null | undefined): MasteryPlan {
  if (plan === "pro" || plan === "platinum") return plan;
  return "free";
}

// ── Effective-tier resolution (status-aware) ─────────────────────────────────
// past_due / canceled subs revert to free immediately so we don't keep paying
// out the 1.5×/2× multiplier on a card that already failed.
export function effectiveTier(
  plan: string | null | undefined,
  status: string | null | undefined,
): MasteryPlan {
  if (status === "past_due" || status === "canceled" || status === "incomplete") {
    return "free";
  }
  return normalizePlan(plan);
}

export function multiplierForTier(tier: MasteryPlan): number {
  return PLAN_FANG_MULTIPLIER[tier] ?? 1;
}

/**
 * Apply the user's plan multiplier to a base Fang grant. Pulls subscription
 * tier + status from `profiles` (one extra read); prefer `applyFangMultiplierFromTier`
 * when the calling route already loaded those columns.
 *
 * `supabase` is loosely typed to avoid a hard dependency on @supabase/supabase-js
 * generic plumbing in this file — callers pass `supabaseAdmin` from
 * `lib/supabase-server.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyFangMultiplier(
  baseAmount: number,
  userId: string,
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<number> {
  if (baseAmount <= 0) return baseAmount;
  const { data } = await supabase
    .from("profiles")
    .select("plan, subscription_status")
    .eq("id", userId)
    .single();
  const row = data as { plan?: string | null; subscription_status?: string | null } | null;
  const tier = effectiveTier(row?.plan, row?.subscription_status);
  return Math.round(baseAmount * multiplierForTier(tier));
}

/** Sync variant for routes that already loaded plan + subscription_status. */
export function applyFangMultiplierFromTier(
  baseAmount: number,
  plan: string | null | undefined,
  status: string | null | undefined,
): number {
  if (baseAmount <= 0) return baseAmount;
  const tier = effectiveTier(plan, status);
  return Math.round(baseAmount * multiplierForTier(tier));
}
