// Balance-pass tests for the LionDesk economy and difficulty tuning (Idea 24).
//
// Now that scoring is consolidated in scoring.ts and the SLA breach sweep actually
// fires (the engine TICK case commits the landedAt stamp every tick), the payout
// and difficulty constants were retuned. This file locks the tuned constant VALUES
// and, more importantly, the INVARIANTS the tune must preserve, so a future retune
// cannot quietly break fairness:
//
//   1. A payout can never exceed its per shift Fang ceiling.
//   2. At equal score and equal play, payout is non decreasing in difficulty
//      (Easy pays at most what Normal pays at most what Hard pays).
//   3. The clean clear bonus is small and bounded, and no bonus stack on a lower
//      tier can reach the Hard ceiling factor of 1.0.
//   4. The best streak bonus is capped, ramps monotonically, and clamps the
//      weight to 1.
//   5. Regression guard: an item left past its SLA budget now actually breaches,
//      and the breach penalty grows with difficulty (Easy stings least).
//
// The economy stays server authoritative: every Fang number here is the shared
// preview math (payoutWeight / shiftPayout). Nothing in this file grants anything.

import { describe, expect, it } from "vitest";

import {
  BREACH_PENALTY,
  DIFF,
  PAYOUT_CLEAN_CLEAR_BONUS,
  PAYOUT_DIFFICULTY_FACTOR,
  PAYOUT_STREAK_MAX,
  PAYOUT_STREAK_STEP,
  SLA_BUDGET,
  buildInitial,
  makeReducer,
  payoutWeight,
  shiftPayout,
  type Action,
  type Difficulty,
  type State,
} from "../engine";
import type { ActionCard, Shift, ShiftItem } from "../types";

const DIFFS: Difficulty[] = ["easy", "normal", "hard"];

/* ───────────────────────── synthetic content + harness ───────────────────────── */
// Tiny, local copies of the engine.test.ts helpers: synthetic shifts keep the
// tune under test, not the authored content.

function action(o: Partial<ActionCard> & { id: string }): ActionCard {
  return { label: "Apply the fix", csat: 0, teach: "That is the right move.", ...o };
}

function ticketItem(
  o: Partial<ShiftItem> & { id: string; subject: string; reward: number; xp: number; actions: ActionCard[] },
): ShiftItem {
  return {
    channel: "ticket",
    priority: "P3",
    from: { name: "Riley Staff", role: "Staff" },
    slaMinutes: 15,
    arriveAfter: 0,
    goal: "Resolve the request.",
    hint: "Read the evidence first.",
    ...o,
  };
}

function makeShift(o: Partial<Shift> & { id: string; items: ShiftItem[] }): Shift {
  return {
    track: "helpdesk",
    order: 0,
    name: "Balance Bench",
    rank: "Help Desk Technician",
    durationSeconds: 600,
    startingBudget: 0,
    inventory: [],
    kb: [],
    adUsers: [],
    ...o,
  };
}

function runTicks(shift: Shift, difficulty: Difficulty, n: number): State {
  const reduce = makeReducer(shift);
  let s = reduce(buildInitial(shift), { t: "START", difficulty });
  for (let i = 0; i < n; i++) s = reduce(s, { t: "TICK" } as Action);
  return s;
}

/* ───────────────────────── tuned constant values ───────────────────────── */
// Locked so any drift is a deliberate, visible edit, not a silent regression.

describe("balance: tuned payout constants", () => {
  it("locks the difficulty payout factors at a flat 0.2 step", () => {
    // Hard pays the full ceiling; each easier tier steps down 0.2 (Hard worth
    // about 1.67x an Easy clear at equal score, up from about 1.4x).
    expect(PAYOUT_DIFFICULTY_FACTOR.easy).toBe(0.6);
    expect(PAYOUT_DIFFICULTY_FACTOR.normal).toBe(0.8);
    expect(PAYOUT_DIFFICULTY_FACTOR.hard).toBe(1);
    // strictly increasing, so a harder tier always weights at least as much.
    expect(PAYOUT_DIFFICULTY_FACTOR.easy).toBeLessThan(PAYOUT_DIFFICULTY_FACTOR.normal);
    expect(PAYOUT_DIFFICULTY_FACTOR.normal).toBeLessThan(PAYOUT_DIFFICULTY_FACTOR.hard);
  });

  it("locks the clean clear bonus and the streak ramp and cap", () => {
    expect(PAYOUT_CLEAN_CLEAR_BONUS).toBe(0.05);
    expect(PAYOUT_STREAK_STEP).toBe(0.01);
    expect(PAYOUT_STREAK_MAX).toBe(0.08);
    // the cap is reached at a best streak of 8, the in-shift multiplier ladder top.
    expect(PAYOUT_STREAK_MAX / PAYOUT_STREAK_STEP).toBe(8);
  });

  it("locks the difficulty multiplier ladders so the tiers stay ordered", () => {
    // Tuned this pass: Easy pen softened to 0.5, Hard pen sharpened to 1.5, now
    // that the SLA breach sweep fires and pen scales a live penalty.
    expect(DIFF.easy.pen).toBe(0.5);
    expect(DIFF.normal.pen).toBe(1);
    expect(DIFF.hard.pen).toBe(1.5);
    // penalties climb with difficulty; SLA budget shrinks; patience drains faster.
    expect(DIFF.easy.pen).toBeLessThan(DIFF.normal.pen);
    expect(DIFF.normal.pen).toBeLessThan(DIFF.hard.pen);
    expect(DIFF.easy.sla).toBeGreaterThan(DIFF.normal.sla);
    expect(DIFF.normal.sla).toBeGreaterThan(DIFF.hard.sla);
    expect(DIFF.easy.patience).toBeLessThan(DIFF.normal.patience);
    expect(DIFF.normal.patience).toBeLessThan(DIFF.hard.patience);
    expect(DIFF.easy.csat).toBeLessThan(DIFF.normal.csat);
    expect(DIFF.normal.csat).toBeLessThan(DIFF.hard.csat);
    // lifeline allotment shrinks as difficulty climbs (more help when it is easy).
    const lifelines = (d: Difficulty) => DIFF[d].coffee + DIFF[d].senior;
    expect(lifelines("easy")).toBeGreaterThan(lifelines("normal"));
    expect(lifelines("normal")).toBeGreaterThan(lifelines("hard"));
    // tries per item shrink too.
    expect(DIFF.easy.attempts).toBeGreaterThan(DIFF.normal.attempts);
    expect(DIFF.normal.attempts).toBeGreaterThan(DIFF.hard.attempts);
  });

  it("keeps the base SLA and breach ladders sane by priority", () => {
    // Higher priority means a shorter budget (more urgent) and a bigger hit.
    expect(SLA_BUDGET.P1).toBeLessThan(SLA_BUDGET.P2);
    expect(SLA_BUDGET.P2).toBeLessThan(SLA_BUDGET.P3);
    expect(SLA_BUDGET.P3).toBeLessThan(SLA_BUDGET.P4);
    expect(BREACH_PENALTY.P1).toBeGreaterThan(BREACH_PENALTY.P2);
    expect(BREACH_PENALTY.P2).toBeGreaterThan(BREACH_PENALTY.P3);
    expect(BREACH_PENALTY.P3).toBeGreaterThan(BREACH_PENALTY.P4);
  });
});

/* ───────────────────────── payout invariants ───────────────────────── */

describe("balance: payout invariants", () => {
  const CEILINGS = [0, 1, 100, 220, 360, 9999];
  const SCORES = [0, 49, 50, 65, 80, 90, 100];
  const STREAKS = [0, 1, 3, 8, 20, 100];

  it("never pays above the per shift ceiling and never goes negative", () => {
    for (const ceiling of CEILINGS)
      for (const score of SCORES)
        for (const d of DIFFS)
          for (const used of [false, true])
            for (const streak of STREAKS) {
              const pay = shiftPayout(ceiling, score, d, used, streak);
              expect(pay).toBeGreaterThanOrEqual(0);
              expect(pay).toBeLessThanOrEqual(Math.max(0, Math.round(ceiling)));
            }
  });

  it("is non decreasing in difficulty at equal score and equal play", () => {
    for (const ceiling of [100, 220, 360])
      for (const score of SCORES)
        for (const used of [false, true])
          for (const streak of STREAKS) {
            const easy = shiftPayout(ceiling, score, "easy", used, streak);
            const normal = shiftPayout(ceiling, score, "normal", used, streak);
            const hard = shiftPayout(ceiling, score, "hard", used, streak);
            expect(easy).toBeLessThanOrEqual(normal);
            expect(normal).toBeLessThanOrEqual(hard);
          }
  });

  it("keeps the clean clear bonus small, exact, and unable to reach the Hard ceiling from a lower tier", () => {
    for (const d of DIFFS)
      for (const streak of STREAKS) {
        const clean = payoutWeight(d, false, streak);
        const dirty = payoutWeight(d, true, streak);
        const bonus = clean - dirty;
        // either the full clean bonus, or 0 once the weight was already clamped to 1.
        expect(bonus === 0 || Math.abs(bonus - PAYOUT_CLEAN_CLEAR_BONUS) < 1e-9).toBe(true);
        expect(bonus).toBeLessThanOrEqual(PAYOUT_CLEAN_CLEAR_BONUS + 1e-9);
      }
    // even the richest possible non Hard weight stays below the Hard ceiling factor.
    const richestNormal = payoutWeight("normal", false, 1000);
    const richestEasy = payoutWeight("easy", false, 1000);
    expect(richestNormal).toBeLessThan(PAYOUT_DIFFICULTY_FACTOR.hard);
    expect(richestEasy).toBeLessThan(PAYOUT_DIFFICULTY_FACTOR.hard);
    expect(richestNormal).toBeCloseTo(0.93, 9); // 0.8 + 0.05 + 0.08
    expect(richestEasy).toBeCloseTo(0.73, 9); // 0.6 + 0.05 + 0.08
  });

  it("caps the streak bonus, ramps it monotonically, and clamps the weight to 1", () => {
    for (const d of DIFFS) {
      let prev = -Infinity;
      for (let streak = 0; streak <= 40; streak++) {
        // a spent lifeline isolates the streak term from the clean clear bonus.
        const w = payoutWeight(d, true, streak);
        expect(w).toBeGreaterThanOrEqual(prev); // non decreasing in streak
        expect(w).toBeLessThanOrEqual(1); // never above the ceiling factor
        prev = w;
        const streakTerm = Math.min(PAYOUT_STREAK_MAX, Math.max(0, streak) * PAYOUT_STREAK_STEP);
        expect(streakTerm).toBeLessThanOrEqual(PAYOUT_STREAK_MAX + 1e-9);
      }
    }
    // Hard already sits at the ceiling, so every bonus clamps it back to exactly 1.
    expect(payoutWeight("hard", false, 100)).toBe(1);
  });
});

/* ───────────────────────── SLA breach regression guard ───────────────────────── */

describe("balance: SLA breach regression guard", () => {
  // A single P1 ticket on a heavily rushed shift (slaScale 0.05) so its budget is
  // a few shift-seconds, far inside the tick window. Before the TICK fix the
  // landedAt stamp was dropped every tick and this NEVER breached.
  const shift = makeShift({
    id: "balance-sla",
    slaScale: 0.05,
    items: [ticketItem({ id: "p1", subject: "Server down", priority: "P1", reward: 100, xp: 40, actions: [action({ id: "p1-ok", correct: true, csat: 0 })] })],
  });

  it("an item left past its SLA budget now actually breaches and keeps its landedAt", () => {
    const after = runTicks(shift, "normal", 30);
    expect(after.items["p1"].landedAt).toBe(1); // stamped on the landing tick and kept
    expect(after.items["p1"].breached).toBe(true);
    expect(after.csat).toBeLessThan(100); // the breach docked CSAT
  });

  it("docks more on harder difficulty (Easy 0.5x, Normal 1x, Hard 1.5x of the base)", () => {
    // By 30 ticks every tier is well past its (rushed) budget, so each has breached
    // exactly once. The one-time hit is 100 - round(BREACH_PENALTY.P1 * DIFF[d].pen).
    const easy = runTicks(shift, "easy", 30);
    const normal = runTicks(shift, "normal", 30);
    const hard = runTicks(shift, "hard", 30);
    expect(easy.items["p1"].breached).toBe(true);
    expect(normal.items["p1"].breached).toBe(true);
    expect(hard.items["p1"].breached).toBe(true);
    expect(easy.csat).toBe(100 - Math.round(BREACH_PENALTY.P1 * DIFF.easy.pen)); // 95
    expect(normal.csat).toBe(100 - Math.round(BREACH_PENALTY.P1 * DIFF.normal.pen)); // 90
    expect(hard.csat).toBe(100 - Math.round(BREACH_PENALTY.P1 * DIFF.hard.pen)); // 85
    // strictly harsher as difficulty climbs.
    expect(easy.csat).toBeGreaterThan(normal.csat);
    expect(normal.csat).toBeGreaterThan(hard.csat);
  });
});
