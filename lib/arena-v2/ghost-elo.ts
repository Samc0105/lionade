/**
 * Pure ELO math for async ghost duels. Standard Elo, K = 32 — identical to the
 * live V1 settle (app/api/arena/complete). A REAL-ghost match is symmetric: the
 * ghost owner's delta is exactly the negation of the live player's, so the
 * rating pool is conserved (the owner is offline, so their delta is buffered on
 * profiles.pending_elo_change and applied on their next login's Claim). There
 * is NO Fang / value transfer anywhere in a ghost duel — this is rating math
 * only. Kept pure + dependency-free so it's trivially unit-testable.
 */
const K = 32;

/** Expected score for A vs B under Elo (0..1). */
export function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

export type GhostOutcome = "win" | "loss" | "draw";

/**
 * Symmetric ELO deltas for a ghost duel, `outcome` from the LIVE player's
 * perspective. Integer deltas; ghostDelta === -liveDelta so the pool is
 * conserved. Trainer-ghost matches call this for the LIVE side only and never
 * buffer the ghostDelta (the trainer system user is outside the player pool).
 */
export function computeSymmetricGhostElo(
  liveElo: number,
  ghostElo: number,
  outcome: GhostOutcome,
): { liveDelta: number; ghostDelta: number } {
  const actual = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
  const expected = expectedScore(liveElo, ghostElo);
  const liveDelta = Math.round(K * (actual - expected));
  return { liveDelta, ghostDelta: -liveDelta };
}
