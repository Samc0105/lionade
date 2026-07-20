// Competitive platform — Fang payout table (locked, data-economist).
//
// All match-end LUMP (never per-round drip — drip is concession-farmable).
// Each non-Poker-Face mode is a PvP transfer (winner gains, loser loses; zero
// net minting) PLUS a thin minted participation reward so a loss isn't pure
// punishment. The net economy is mildly DEFLATIONARY in aggregate (intended,
// fights the inflationary Daily Spin) because the transfer cancels but the
// participation mint is smaller than the win bonus on the spread.
//
// 2v2: per-player payout is ~2/3 of the 1v1 figure (so a duo's combined haul is
// ~4/3 of a solo win, not double — keeps squad farming from out-earning solo).
//
// (Poker Face was moved to Lionade Party as a no-Fang party game on 2026-05-28,
// so there is no longer a staked-pot mode in this table.)

import type { CompetitiveMode, CompetitiveFormat } from "./types";

interface ModePayout {
  /** Minted+transferred swing applied to the winner side per player (1v1). */
  win: number;
  /** Transferred-away amount from the loser side per player (1v1, negative). */
  loss: number;
  /** Minted participation bonus for a WIN (1v1). */
  partWin: number;
  /** Minted participation bonus for a LOSS (1v1). */
  partLoss: number;
}

// Locked figures from project_competitive_modes.md.
const PAYOUTS: Record<CompetitiveMode, ModePayout> = {
  sabotage: { win: 30, loss: -30, partWin: 10, partLoss: 5 },
  zoom: { win: 25, loss: -25, partWin: 8, partLoss: 4 },
  spectrum: { win: 20, loss: -20, partWin: 8, partLoss: 4 },
  pin: { win: 20, loss: -20, partWin: 8, partLoss: 4 },
};

/** Scale per-player payout for the format. 2v2 = ~2/3 of 1v1. */
function formatScale(format: CompetitiveFormat): number {
  return format === "2v2" ? 2 / 3 : 1;
}

export interface PayoutResult {
  /** Signed Fang delta for a winning-team player. */
  winnerDelta: number;
  /** Signed Fang delta for a losing-team player (negative, transfer + mint). */
  loserDelta: number;
  /** Signed Fang delta for each player on a draw (participation only). */
  drawDelta: number;
}

/**
 * Resolve the per-player Fang deltas for a mode + format.
 *
 *   winner gets +(win + partWin); loser gets (loss + partLoss) i.e. -25+4 = -21.
 *   draw: both get the smaller participation (partLoss) since nobody won.
 *
 * Note the loss-cap is enforced separately at the completion endpoint — this
 * function returns the *intended* deltas before any cap clamp.
 */
export function resolvePayout(args: {
  mode: CompetitiveMode;
  format: CompetitiveFormat;
}): PayoutResult {
  const base = PAYOUTS[args.mode];
  const scale = formatScale(args.format);
  // Zero-sum: winner gains exactly what loser loses. No net Fang minting per match.
  const loserDelta = Math.round((base.loss + base.partLoss) * scale);
  return {
    winnerDelta: -loserDelta,
    loserDelta,
    drawDelta: 0,
  };
}
