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
