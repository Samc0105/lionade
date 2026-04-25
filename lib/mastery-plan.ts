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
