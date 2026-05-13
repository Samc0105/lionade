/**
 * Daily Spin — pure slot definitions, weighted RNG, and reward computation.
 *
 * Platform-agnostic. The actual crypto-grade randomness source is injected
 * by the caller (web supplies node:crypto.randomInt; iOS supplies its own
 * RN-compatible RNG when we wire client-side prediction). This file MUST NOT
 * import node:crypto or any platform-specific RNG.
 *
 * Split from web /lib/spin.ts on 2026-05-13.
 *
 * Spec source: DAILY_SPIN_PROPOSAL.md.
 */

export type SpinOutcome =
  | "small_fangs"
  | "bust"
  | "medium_fangs"
  | "booster"
  | "big_fangs"
  | "mega_fangs"
  | "streak_shield"
  | "rare_cosmetic"
  | "tax_man"
  | "jackpot";

export interface SpinSlot {
  outcome: SpinOutcome;
  weight: number;       // probability points (sum of all weights = 100)
  label: string;        // short UI label
  description: string;  // a sentence for the result modal
  // Color hint for the wheel segment. Tailwind classes work via the wheel's `data-` attribute.
  color: string;
}

// ── Slots (must sum to 100) ───────────────────────────────────────────────
export const SPIN_SLOTS: SpinSlot[] = [
  { outcome: "small_fangs",   weight: 30,  label: "Small Fangs",    description: "A modest pile of Fangs.",                 color: "#4A90D9" },
  { outcome: "bust",          weight: 8,   label: "Bust",           description: "Better luck tomorrow — you lost 500F.",   color: "#64748B" },
  { outcome: "medium_fangs",  weight: 20,  label: "Medium Fangs",   description: "Solid pull — some real Fangs.",           color: "#22C55E" },
  { outcome: "booster",       weight: 15,  label: "Free Booster",   description: "You won a random booster.",               color: "#A855F7" },
  { outcome: "big_fangs",     weight: 12,  label: "Big Fangs",      description: "A heavy bag of Fangs.",                   color: "#0EA5E9" },
  { outcome: "mega_fangs",    weight: 5,   label: "Mega Fangs",     description: "2,000F — hyped.",                         color: "#F59E0B" },
  { outcome: "streak_shield", weight: 3,   label: "Streak Shield",  description: "One free streak save — clutch.",          color: "#EF4444" },
  { outcome: "rare_cosmetic", weight: 3,   label: "Rare Cosmetic",  description: "A surprise rare item lands in your bag.", color: "#EC4899" },
  { outcome: "tax_man",       weight: 2,   label: "TAX MAN",        description: "The Tax Man cometh — you lost 33%.",      color: "#7F1D1D" },
  { outcome: "jackpot",       weight: 2,   label: "JACKPOT",        description: "10,000 Fangs. LFG.",                      color: "#FFD700" },
];

// Sanity-check: weights must sum to 100. If anyone edits the array, this
// throws on import in dev so we catch it before shipping.
const WEIGHT_SUM = SPIN_SLOTS.reduce((s, x) => s + x.weight, 0);
if (WEIGHT_SUM !== 100) {
  throw new Error(`SPIN_SLOTS weights must sum to 100, got ${WEIGHT_SUM}`);
}

// ── Pure slot picker ──────────────────────────────────────────────────────
/**
 * Given a roll in [0, 100), return the slot at that probability point.
 * Caller is responsible for supplying cryptographic-grade randomness.
 * On web, that's `crypto.randomInt(0, 100)`. On iOS (if ever needed for
 * client-side prediction or animation timing), supply `Math.floor(Math.random() * 100)`.
 */
export function pickSlotByWeight(roll: number): { index: number; slot: SpinSlot } {
  let cumulative = 0;
  for (let i = 0; i < SPIN_SLOTS.length; i++) {
    cumulative += SPIN_SLOTS[i]!.weight;
    if (roll < cumulative) return { index: i, slot: SPIN_SLOTS[i]! };
  }
  // Mathematically unreachable since weights sum to 100, but TS needs it.
  return { index: SPIN_SLOTS.length - 1, slot: SPIN_SLOTS[SPIN_SLOTS.length - 1]! };
}

// ── Reward shape ──────────────────────────────────────────────────────────
export interface RewardResult {
  fangsDelta: number;     // signed; clamping to "won't push balance below 0" is the API's job
  rewardPayload: Record<string, unknown> | null;
}

// ── Cooldown ──────────────────────────────────────────────────────────────
export const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function nextSpinAt(lastSpunAt: Date | null): Date | null {
  if (!lastSpunAt) return null;
  return new Date(lastSpunAt.getTime() + SPIN_COOLDOWN_MS);
}

export function canSpinNow(lastSpunAt: Date | null, now: Date = new Date()): boolean {
  if (!lastSpunAt) return true;
  return now.getTime() - lastSpunAt.getTime() >= SPIN_COOLDOWN_MS;
}

// ── Plan multiplier lookup ────────────────────────────────────────────────
export function spinMultiplierForPlan(plan: string | null | undefined): number {
  if (plan === "platinum") return 1.5;
  if (plan === "pro") return 1.25;
  return 1.0;
}
