// LionDesk scoring: the single source of truth for the pass threshold, the
// letter-grade ladder, and the live SLA-remaining clock.
//
// Before this module the pass score lived in four places (the engine ladder, the
// campaign progress store, the lifetime stats tracker, and the server payout
// route), the letter-grade ladder was hand-copied in two, and the SLA-remaining
// formula was inlined at two LionDesk render sites. A tweak to any one of them
// silently drifted from the rest. Everything scoring-shaped now lives here, so
// the engine, the UI, and the server all read the same numbers.
//
// This is a pure, framework-free leaf module: no React, no DOM, no localStorage,
// no engine import. That keeps it safe to import from the client UI, the pure
// game engine, and the server completion route alike, with no import cycle.

import type { ShiftItem } from "./types";

/**
 * Minimum shift score that counts as a clear. At or above it the shift unlocks
 * the next one and the server pays out its (clamped) Fang reward; below it grants
 * nothing. The economy stays server-authoritative: this constant only gates the
 * server-side payout math and the client-side display. It never grants on its own.
 */
export const PASS_SCORE = 50;

/**
 * The letter-grade ladder, highest threshold first. A score earns the grade of
 * the first row whose `min` it meets or beats; anything under the last row is "D".
 */
export const GRADE_LADDER: ReadonlyArray<{ min: number; grade: string }> = [
  { min: 90, grade: "S" },
  { min: 80, grade: "A" },
  { min: 65, grade: "B" },
  { min: 50, grade: "C" },
];

/** Letter grade for a 0..100 shift score. */
export function gradeFor(score: number): string {
  for (const { min, grade } of GRADE_LADDER) {
    if (score >= min) return grade;
  }
  return "D";
}

/**
 * Live SLA seconds left on a ticket. A landed ticket counts down from its
 * landedAt; one that has not landed counts from when it becomes live (the current
 * elapsed time for a chained follow-up, its arriveAfter otherwise). `budget` is
 * the priority and difficulty SLA budget from the engine's slaBudget(). The raw
 * value can go negative once breached; callers clamp with Math.max(0, ...) for
 * display.
 */
export function slaRemaining(
  item: Pick<ShiftItem, "revealedBy" | "arriveAfter">,
  runtime: { landedAt: number | null },
  elapsed: number,
  budget: number,
): number {
  return (runtime.landedAt ?? (item.revealedBy ? elapsed : item.arriveAfter)) + budget - elapsed;
}
