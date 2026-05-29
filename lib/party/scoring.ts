// Scoring helpers for Lionade Party games.

// ── Sketchy Subjects ──
// 1st correct: +1000, 2nd: +600, 3rd: +400, 4th+: +200.
// Drawer earns 100 per correct guesser, +200 bonus if 80%+ guess within first 30s.
export function sketchGuessPoints(rank: number): number {
  if (rank <= 0) return 0;
  if (rank === 1) return 1000;
  if (rank === 2) return 600;
  if (rank === 3) return 400;
  return 200;
}

export function sketchDrawerPoints(correctGuessers: number, fastGuesserRatio: number): number {
  const base = correctGuessers * 100;
  const bonus = fastGuesserRatio >= 0.8 ? 200 : 0;
  return base + bonus;
}

// ── Bluff Trivia ──
// Picking the truth: +1000. Every player tricked by your fake: +500.
export const BLUFF_TRUTH_POINTS = 1000;
export const BLUFF_FAKE_TRICK_POINTS = 500;

// ── Poker Face (party) ──
// NO ELO, NO Fang wager — pure points. The scoring matrix:
//   Presenter scores when they FOOL a caller: each caller who calls the wrong
//     way (believed a lie, or doubted a truth) earns the presenter points.
//   Callers score when they call CORRECTLY: catching a lie (doubt + is_lie) or
//     trusting a truth (believe + truth) earns the caller points.
// Tuned so a confident bluffer who fools the whole room out-scores a single
// correct caller, but a sharp room shuts a liar down — symmetric and readable.
export const POKERFACE_FOOL_POINTS = 500;   // presenter, per caller fooled
export const POKERFACE_CORRECT_CALL_POINTS = 400;  // caller, for a correct read
// Caught red-handed: a LIE that fooled NOBODY (the whole room doubted) costs the
// presenter a flat penalty, so lying isn't free and the truth/lie call carries
// real risk. Only on the total-whiff case (one readable rule, never per-caller).
export const POKERFACE_CAUGHT_PENALTY = 200;

// Single source of truth for per-round Poker Face points, used by BOTH the
// reveal-preview GET route and the authoritative complete/scoring route so the
// displayed round points always equal the banked deltas. Caller correct read
// (doubt a lie / believe a truth) earns the caller; each fooled caller earns the
// presenter; a fully-doubted lie docks the presenter the caught penalty.
export function pokerFaceRoundPoints(
  isLie: boolean,
  calls: { voter_user_id: string; call: "believe" | "doubt" }[],
  presenterUserId: string,
): Record<string, number> {
  const points: Record<string, number> = {};
  let fooled = 0;
  for (const c of calls) {
    const correct = (c.call === "doubt" && isLie) || (c.call === "believe" && !isLie);
    if (correct) {
      points[c.voter_user_id] = (points[c.voter_user_id] ?? 0) + POKERFACE_CORRECT_CALL_POINTS;
    } else {
      fooled += 1;
      points[presenterUserId] = (points[presenterUserId] ?? 0) + POKERFACE_FOOL_POINTS;
    }
  }
  if (isLie && calls.length > 0 && fooled === 0) {
    points[presenterUserId] = (points[presenterUserId] ?? 0) - POKERFACE_CAUGHT_PENALTY;
  }
  return points;
}
