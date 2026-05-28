// Poker Face — BOUNDED "Challenge Stakes" engine.
//
// LEGAL RECONCILIATION (project_competitive_modes.md): business-legal-compliance
// overrode the data-economist proposal. The version SHIPPING NOW is bounded and
// sits under the existing Arena wager precedent:
//   - Matched opening stake from [10, 25, 50] only.
//   - At most ONE bounded raise, capped at 2x the opening stake.
//   - Total per-side exposure capped at 250 AND at min(opponent balance,
//     daily-loss-cap headroom).
//   - NO all-in. NO multi-raise. NO house rake. Pure zero-sum winner-takes-pot.
//   - Framed as "Challenge Stakes" / "Stake" / "Prize" — never bet/pot/all-in/
//     rake/casino (design-copywriter + legal rule).
//
//   GATED — requires a real gaming lawyer before building (do NOT ship):
//     true all-in, multi-raise escalation, house rake, an explicit "18+ casino
//     mode" framing, and any wagering of IAP-purchased Fangs framed as gambling.
//   See the clearly-marked TODO blocks below for where those would hook in.

export const OPENING_STAKES = [10, 25, 50] as const;
export type OpeningStake = (typeof OPENING_STAKES)[number];

/** Hard ceiling on total per-side exposure regardless of balances (legal cap). */
export const MAX_TOTAL_STAKE = 250;

/** A raise may be at most this multiple of the opening stake (one raise only). */
export const MAX_RAISE_MULTIPLIER = 2;

export function isValidOpeningStake(v: unknown): v is OpeningStake {
  return typeof v === "number" && (OPENING_STAKES as readonly number[]).includes(v);
}

/**
 * Clamp a raise amount to the bounded rules.
 *   - raise <= openingStake * MAX_RAISE_MULTIPLIER  (the "one small bounded raise")
 *   - opening + raise (total exposure) <= MAX_TOTAL_STAKE
 *   - opening + raise <= each side's available headroom
 *
 * headroom = min(opener balance, caller balance, opener loss-cap headroom,
 *                caller loss-cap headroom). Passing the smallest of these in as
 *                `headroom` keeps the call site simple.
 *
 * Returns the clamped raise (>= 0). A return of 0 means "no raise allowed."
 */
export function clampRaise(args: {
  openingStake: number;
  requestedRaise: number;
  headroom: number;
}): number {
  if (args.requestedRaise <= 0) return 0;
  const byMultiplier = args.openingStake * MAX_RAISE_MULTIPLIER;
  const byTotalCap = MAX_TOTAL_STAKE - args.openingStake;
  const byHeadroom = Math.max(0, args.headroom - args.openingStake);
  const clamped = Math.min(
    args.requestedRaise,
    byMultiplier,
    byTotalCap,
    byHeadroom,
  );
  return Math.max(0, Math.floor(clamped));

  // ── GATED (lawyer-required) ──────────────────────────────────────────
  // To enable all-in / multi-raise escalation, this function would accept a
  // `raiseCount` and remove the MAX_RAISE_MULTIPLIER / MAX_TOTAL_STAKE caps,
  // and an "all-in" path would set raise = headroom. DO NOT implement without
  // counsel — see project_competitive_modes.md "GATED" block.
}

export type Call = "believe" | "doubt";

/**
 * Poker Face confidence-wager scoring matrix. The confidence wager IS the tell
 * (remote play has no face). Returns the winner: "presenter" or "caller", plus
 * whether the presenter wins the FULL stake or only a SMALL consolation.
 *
 *   presenter LIED + caller BELIEVED  → presenter wins full stake (the bluff landed)
 *   presenter LIED + caller DOUBTED    → caller wins full stake (caught the lie)
 *   presenter TRUTH + caller BELIEVED  → presenter wins SMALL (truth, but no risk taken)
 *   presenter TRUTH + caller DOUBTED   → presenter wins full stake (caller cried wolf)
 */
export function resolveHand(args: {
  presenterToldTruth: boolean;
  call: Call;
}): { winner: "presenter" | "caller"; magnitude: "full" | "small" } {
  const { presenterToldTruth, call } = args;
  if (!presenterToldTruth) {
    // Presenter lied.
    return call === "believe"
      ? { winner: "presenter", magnitude: "full" }
      : { winner: "caller", magnitude: "full" };
  }
  // Presenter told the truth.
  return call === "believe"
    ? { winner: "presenter", magnitude: "small" }
    : { winner: "presenter", magnitude: "full" };
}

/** The "small" consolation fraction of the stake a truthful-believed presenter wins. */
export const SMALL_WIN_FRACTION = 0.4;
