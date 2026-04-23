/**
 * Plan-tier caps for Mastery Mode. Source of truth used by the server
 * (exam-creation enforcement) and the client (paywall copy).
 *
 *   free      — 1 active target (focus enforcement)
 *   pro       — 3 active targets
 *   platinum  — 8 active targets (teams, power users)
 *
 * "Active" = not archived. Archived targets (auto-aged or manually hidden)
 * don't count against the cap.
 */

export const PLAN_EXAM_LIMITS = {
  free: 1,
  pro: 3,
  platinum: 8,
} as const;

export type MasteryPlan = keyof typeof PLAN_EXAM_LIMITS;

export function planLimit(plan: string | null | undefined): number {
  if (plan === "pro" || plan === "platinum") return PLAN_EXAM_LIMITS[plan];
  return PLAN_EXAM_LIMITS.free;
}
