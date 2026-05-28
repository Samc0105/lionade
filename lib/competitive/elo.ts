// Competitive platform — ELO engine (K=32), mirroring the Arena V2 pattern.
//
// Two ladders, format-based, shared across all 5 modes:
//   - competitive_elo (1v1)
//   - squad_elo       (2v2)
// Both default 1000, K=32. We compute a team-vs-team update using the AVERAGE
// team rating as the matchup rating, then apply the resulting per-team delta to
// every member of that team. This keeps the pool conserved at the team level
// (team A's gain == team B's loss) and is the standard approach for small-team
// ladders where individual contribution isn't separately measured.
//
// Legacy profiles.arena_elo is never touched here.

export const K_FACTOR = 32;

/** Expected score for team A vs team B given their (average) ratings. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function averageRating(ratings: number[]): number {
  if (ratings.length === 0) return 1000;
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

export interface TeamEloResult {
  /** Signed delta to apply to EACH member of team A. */
  teamADelta: number;
  /** Signed delta to apply to EACH member of team B. */
  teamBDelta: number;
}

/**
 * Compute the K=32 ELO deltas for a team-vs-team result.
 *
 * `actualA` is team A's match outcome: 1 = win, 0.5 = draw, 0 = loss.
 * The deltas are symmetric at the team level (teamADelta == -teamBDelta) so
 * the rating pool stays conserved.
 */
export function computeTeamElo(args: {
  teamARatings: number[];
  teamBRatings: number[];
  actualA: 0 | 0.5 | 1;
}): TeamEloResult {
  const ratingA = averageRating(args.teamARatings);
  const ratingB = averageRating(args.teamBRatings);
  const expA = expectedScore(ratingA, ratingB);
  const deltaA = Math.round(K_FACTOR * (args.actualA - expA));
  return { teamADelta: deltaA, teamBDelta: -deltaA };
}

/**
 * Convenience: given a winner ('a' | 'b' | 'draw'), produce the per-user ELO
 * delta map keyed by user_id, starting from each user's pre-match rating.
 */
export function buildEloDeltas(args: {
  teamA: string[];
  teamB: string[];
  eloBefore: Record<string, number>;
  winner: "a" | "b" | "draw";
}): { deltas: Record<string, number>; eloAfter: Record<string, number> } {
  const teamARatings = args.teamA.map((u) => args.eloBefore[u] ?? 1000);
  const teamBRatings = args.teamB.map((u) => args.eloBefore[u] ?? 1000);
  const actualA: 0 | 0.5 | 1 =
    args.winner === "a" ? 1 : args.winner === "draw" ? 0.5 : 0;
  const { teamADelta, teamBDelta } = computeTeamElo({
    teamARatings,
    teamBRatings,
    actualA,
  });

  const deltas: Record<string, number> = {};
  const eloAfter: Record<string, number> = {};
  for (const u of args.teamA) {
    deltas[u] = teamADelta;
    eloAfter[u] = (args.eloBefore[u] ?? 1000) + teamADelta;
  }
  for (const u of args.teamB) {
    deltas[u] = teamBDelta;
    eloAfter[u] = (args.eloBefore[u] ?? 1000) + teamBDelta;
  }
  return { deltas, eloAfter };
}
