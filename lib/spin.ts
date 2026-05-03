/**
 * Daily Spin — slot definitions, weighted RNG, and reward computation.
 *
 * SERVER-ONLY. Never import from a client component — the slot weights and
 * RNG must never run client-side or users could pre-compute or rig outcomes.
 *
 * Spec source: DAILY_SPIN_PROPOSAL.md.
 */
import { randomInt } from "node:crypto";

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

// ── RNG ────────────────────────────────────────────────────────────────────
/**
 * Picks a slot by weight using crypto.randomInt for cryptographic-grade
 * randomness. Returns the slot index (0..9) and the chosen slot.
 */
export function rollSlot(): { index: number; slot: SpinSlot } {
  const roll = randomInt(0, 100); // 0..99 inclusive
  let cumulative = 0;
  for (let i = 0; i < SPIN_SLOTS.length; i++) {
    cumulative += SPIN_SLOTS[i].weight;
    if (roll < cumulative) return { index: i, slot: SPIN_SLOTS[i] };
  }
  // Mathematically unreachable since weights sum to 100, but TS needs it.
  return { index: SPIN_SLOTS.length - 1, slot: SPIN_SLOTS[SPIN_SLOTS.length - 1] };
}

// ── Reward math ───────────────────────────────────────────────────────────
export interface RewardResult {
  fangsDelta: number;     // signed; clamping to "won't push balance below 0" is the API's job
  rewardPayload: Record<string, unknown> | null;
}

/**
 * Compute the Fangs delta + any side-payload (booster id, cosmetic id) for
 * a given outcome. Pass in the user's current balance so Tax Man scales
 * correctly. Plan multiplier (1.0 / 1.25 / 1.5 for free / pro / platinum)
 * is applied to POSITIVE Fangs payouts only — losses are never softened.
 */
export function computeReward(
  outcome: SpinOutcome,
  currentBalance: number,
  planMultiplier: number,
): RewardResult {
  const positiveBoost = (n: number) => Math.round(n * planMultiplier);

  switch (outcome) {
    case "small_fangs":
      // Random integer 50..150 inclusive
      return { fangsDelta: positiveBoost(randomInt(50, 151)), rewardPayload: null };
    case "bust":
      // Flat -500F, no plan softening
      return { fangsDelta: -500, rewardPayload: { kind: "bust" } };
    case "medium_fangs":
      return { fangsDelta: positiveBoost(randomInt(200, 401)), rewardPayload: null };
    case "booster": {
      // Random booster id from a small curated pool
      const ids = ["boost_coin_rush", "boost_xp_surge", "boost_lucky_start"] as const;
      const id = ids[randomInt(0, ids.length)];
      return { fangsDelta: 0, rewardPayload: { kind: "booster", boosterId: id } };
    }
    case "big_fangs":
      return { fangsDelta: positiveBoost(randomInt(500, 1001)), rewardPayload: null };
    case "mega_fangs":
      return { fangsDelta: positiveBoost(2000), rewardPayload: null };
    case "streak_shield":
      // Caller is responsible for granting the shield to the user's inventory.
      return { fangsDelta: 0, rewardPayload: { kind: "streak_shield", days: 1 } };
    case "rare_cosmetic": {
      // Caller picks an actual rare item id the user doesn't already own.
      // If they own everything, the API falls back to a flat 1,000F payout
      // and overrides the outcome to 'big_fangs' for the audit row.
      return { fangsDelta: 0, rewardPayload: { kind: "rare_cosmetic" } };
    }
    case "tax_man": {
      // -33% of CURRENT balance, rounded down so we never charge a fractional Fang.
      // Server-side balance is the source of truth; client-side balance is ignored.
      const loss = Math.floor(currentBalance * 0.33);
      return { fangsDelta: -loss, rewardPayload: { kind: "tax_man", percent: 33 } };
    }
    case "jackpot":
      return { fangsDelta: positiveBoost(10000), rewardPayload: { kind: "jackpot" } };
  }
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
