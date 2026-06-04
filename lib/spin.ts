/**
 * Daily Spin — web-side RNG entry point.
 *
 * SERVER-ONLY. Never import from a client component — the slot weights and
 * RNG must never run client-side or users could pre-compute or rig outcomes.
 *
 * The platform-agnostic pieces (slot table, weight picker, cooldown math,
 * reward shape, plan multiplier) live in @lionade/core/logic/spin-rng and
 * are re-exported here for backward compat. The node:crypto-using pieces
 * (rollSlot and computeReward) STAY in this file because crypto.randomInt
 * is server-side only.
 *
 * Spec source: DAILY_SPIN_PROPOSAL.md.
 */
import { randomInt } from "node:crypto";
import {
  SPIN_SLOTS,
  pickSlotByWeight,
  type SpinOutcome,
  type SpinSlot,
  type RewardResult,
} from "@lionade/core/logic/spin-rng";

// Re-export the platform-agnostic surface so existing imports keep working.
export {
  SPIN_SLOTS,
  pickSlotByWeight,
  SPIN_COOLDOWN_MS,
  nextSpinAt,
  canSpinNow,
  spinMultiplierForPlan,
} from "@lionade/core/logic/spin-rng";
export type { SpinOutcome, SpinSlot, RewardResult } from "@lionade/core/logic/spin-rng";

/**
 * Crypto-grade weighted slot pick. Wraps the pure picker from core with
 * node:crypto.randomInt for entropy that can't be predicted client-side.
 */
export function rollSlot(): { index: number; slot: SpinSlot } {
  const roll = randomInt(0, 100); // 0..99 inclusive
  return pickSlotByWeight(roll);
}

/**
 * Compute the Fangs delta + any side-payload (booster id, cosmetic id) for
 * a given outcome. Pass in the user's current balance so Tax Man scales
 * correctly. Plan multiplier (1.0 / 1.25 / 1.5 for free / pro / platinum)
 * is applied to POSITIVE Fangs payouts only — losses are never softened.
 *
 * Stays server-side because random booster id pick uses node:crypto.randomInt.
 */
export function computeReward(
  outcome: SpinOutcome,
  currentBalance: number,
  planMultiplier: number,
): RewardResult {
  const positiveBoost = (n: number) => Math.round(n * planMultiplier);

  switch (outcome) {
    case "small_fangs":
      // Random integer 50..100 (was 50..150 — Sam flagged 2026-06-04 that
      // spin was paying out too much; expected value per pull dropped from
      // ~440F to ~270F for Free users so the spin no longer overshadows a
      // day's worth of regular gameplay earning).
      return { fangsDelta: positiveBoost(randomInt(50, 101)), rewardPayload: null };
    case "bust":
      // Flat -500F, no plan softening
      return { fangsDelta: -500, rewardPayload: { kind: "bust" } };
    case "medium_fangs":
      // Was 200..400 — halved range
      return { fangsDelta: positiveBoost(randomInt(150, 301)), rewardPayload: null };
    case "booster": {
      // Random booster id from a small curated pool
      const ids = ["boost_coin_rush", "boost_xp_surge", "boost_lucky_start"] as const;
      const id = ids[randomInt(0, ids.length)];
      return { fangsDelta: 0, rewardPayload: { kind: "booster", boosterId: id } };
    }
    case "big_fangs":
      // Was 500..1000 — halved range
      return { fangsDelta: positiveBoost(randomInt(400, 701)), rewardPayload: null };
    case "mega_fangs":
      // Was 2000 flat — reduced to 1500
      return { fangsDelta: positiveBoost(1500), rewardPayload: null };
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
      // Was 10,000F — halved to 5,000F. Still a hyped LFG moment without
      // single-handedly funding a week of subscription-multiplier earnings.
      return { fangsDelta: positiveBoost(5000), rewardPayload: { kind: "jackpot" } };
  }
}
