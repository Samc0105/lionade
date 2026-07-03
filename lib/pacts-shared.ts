/**
 * Streak Pacts — CLIENT-SAFE shared types + constants.
 *
 * No imports (nothing server-only): safe for components/PactCard.tsx,
 * components/social/PactsSection.tsx, and any future pact surface. The
 * server core (lib/pacts.ts) re-exports PACT_MILESTONES from here so the
 * numbers a card renders can never drift from the numbers the API pays.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Feature accent (one per feature, per the design system): warm flame orange. */
export const PACT_ACCENT = "#FF9F45";

/** Milestone day -> Fangs paid to EACH member when the pair crosses it. */
export const PACT_MILESTONES = { 7: 50, 30: 250 } as const;

export type PactMilestoneDay = keyof typeof PACT_MILESTONES; // 7 | 30

/**
 * The next unclaimed milestone for a pact, or null when both are claimed.
 * Single source for the 7/50 and 30/250 pairs the UI shows.
 */
export function nextPactMilestone(p: {
  milestone7Granted: boolean;
  milestone30Granted: boolean;
}): { target: PactMilestoneDay; reward: number } | null {
  if (!p.milestone7Granted) return { target: 7, reward: PACT_MILESTONES[7] };
  if (!p.milestone30Granted) return { target: 30, reward: PACT_MILESTONES[30] };
  return null;
}

// ── API response shapes (GET /api/pacts) ────────────────────────────────────

export interface PactPartner {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface ActivePact {
  id: string;
  partner: PactPartner;
  currentStreak: number;
  bestStreak: number;
  lastBothDay?: string | null;
  youStudiedToday: boolean;
  partnerStudiedToday: boolean;
  milestone7Granted: boolean;
  milestone30Granted: boolean;
  milestonePending: boolean;
  canNudge: boolean;
  createdAt?: string;
}

export interface PactInvite {
  id: string;
  partner: PactPartner;
  createdAt?: string;
}

export interface PactsResponse {
  available: boolean;
  maxActive: number;
  activeCount?: number;
  pacts: ActivePact[];
  incoming: PactInvite[];
  outgoing: PactInvite[];
}
