// Sabotage Trivia — attack economy (data-economist balance pass).
//
// Goal: a skilled player (answers correctly and fast) should accrue roughly
// 3-5 attacks across a ~90 second match, and NOT be able to chain-spam them.
//
// Charge model:
//   - The meter is 0..100 (a full charge = 100).
//   - A correct answer grants base charge; faster answers grant a speed bonus.
//   - The cheapest attack costs 35, the priciest 60. With ~6-8 questions in a
//     90s match and ~25-40 charge per good answer, a strong player banks
//     ~200-300 charge total => 3-5 attacks. A weak player banks far less.
//   - A global cooldown (4s) between fires prevents dumping a full meter at once.

import type { SabotageAttackKind } from "./channels";

export const METER_MAX = 100;
export const ATTACK_COOLDOWN_MS = 4000;

/** Per-attack charge cost. Tuned for ~3-5 attacks / skilled 90s match. */
export const ATTACK_COSTS: Record<SabotageAttackKind, number> = {
  fog: 35,
  freeze: 40,
  scramble: 45,
  blur: 45,
  decoy: 50,
  drain: 60,
};

/** Human-facing labels + descriptions for the attack tray UI. */
export const ATTACK_META: Record<
  SabotageAttackKind,
  { label: string; desc: string; icon: string }
> = {
  blur: { label: "Blur", desc: "Blur their question for 3 seconds", icon: "👁" },
  scramble: { label: "Scramble", desc: "Shuffle their answer options", icon: "🔀" },
  drain: { label: "Drain", desc: "Drain 5 seconds off their clock", icon: "⏳" },
  decoy: { label: "Decoy", desc: "Flag a wrong answer as suggested", icon: "🎭" },
  freeze: { label: "Freeze", desc: "Freeze their input for 2 seconds", icon: "❄️" },
  fog: { label: "Fog", desc: "Hide two of their options briefly", icon: "🌫" },
};

/**
 * Charge earned for a correct answer.
 *   base 18 + speed bonus up to 22 (answered instantly) scaling to 0 at the
 *   time limit. Wrong answers earn 0.
 */
export function chargeForAnswer(args: {
  correct: boolean;
  responseMs: number;
  timeLimitMs: number;
}): number {
  if (!args.correct) return 0;
  const base = 18;
  const frac = Math.max(0, 1 - args.responseMs / Math.max(1, args.timeLimitMs));
  const speedBonus = Math.round(22 * frac);
  return base + speedBonus;
}

export interface MeterState {
  charge: number;
  lastFiredAt: number;
}

export function canFire(
  state: MeterState,
  kind: SabotageAttackKind,
  now: number,
): { ok: boolean; reason?: "cooldown" | "insufficient" } {
  if (now - state.lastFiredAt < ATTACK_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown" };
  }
  if (state.charge < ATTACK_COSTS[kind]) {
    return { ok: false, reason: "insufficient" };
  }
  return { ok: true };
}

export function applyFire(
  state: MeterState,
  kind: SabotageAttackKind,
  now: number,
): MeterState {
  return {
    charge: Math.max(0, state.charge - ATTACK_COSTS[kind]),
    lastFiredAt: now,
  };
}

export function applyCharge(state: MeterState, amount: number): MeterState {
  return { ...state, charge: Math.min(METER_MAX, state.charge + amount) };
}
