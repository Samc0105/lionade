// Sketchy Subjects — Fang reward faucet (locked, data-economist).
//
// THIS IS A FAUCET, NOT A WAGER. No Fangs are staked or transferred between
// players; Party mints a SMALL participation reward on a guessed word. The
// numbers are tuned to stay well below a single quiz session (~50-150 Fangs)
// and below a competitive win swing, so Party never becomes a Fang printer.
//
// Net mint per typical 4-player round (1 drawer + 3 guessers):
//   guessers:  6 + 5 + 4                 = 15   (base 3 + order bonus 3/2/1/0)
//   letters:   ~3 (deduped, capped 8/pp)  ≈  3
//   drawer:    2 per correct guesser, cap = 6
//   ───────────────────────────────────────────
//   ≈ 24 Fangs/round  ≈ 6 Fangs/player/round
// A full 8-round game ≈ 48 Fangs/player — under one quiz session. Mildly
// inflationary in isolation but the smallest per-minute faucet we run, so the
// aggregate Fang economy stays sane (the Daily Spin and quizzes dominate mint).

/** Base Fangs for any correct guess. */
export const SKETCH_GUESS_BASE_FANGS = 3;

/** Speed/order bonus on top of the base, indexed by finish rank (1 = first). */
export function sketchGuessOrderBonus(rank: number): number {
  if (rank <= 1) return 3; // 1st correct
  if (rank === 2) return 2;
  if (rank === 3) return 1;
  return 0; // 4th+ — base only
}

/** Total minted Fangs for a correct guess at the given finish rank. */
export function sketchGuessFangs(rank: number): number {
  return SKETCH_GUESS_BASE_FANGS + sketchGuessOrderBonus(rank);
}

/** Fangs minted to the guesser who first reveals a new correct-position letter. */
export const SKETCH_LETTER_FANGS = 1;

/** Per-round cap on per-letter Fangs for a single player (anti long-word farm). */
export const SKETCH_LETTER_FANGS_CAP_PER_PLAYER = 8;

/** Fangs the drawer earns per correct guesser when their word gets guessed. */
export const SKETCH_DRAWER_FANGS_PER_GUESSER = 2;

/** Per-round cap on the drawer's Fang reward (anti big-room farm). */
export const SKETCH_DRAWER_FANGS_CAP = 10;

/** Drawer's minted Fangs for a round given how many guessers got the word. */
export function sketchDrawerFangs(correctGuessers: number): number {
  return Math.min(
    SKETCH_DRAWER_FANGS_CAP,
    Math.max(0, correctGuessers) * SKETCH_DRAWER_FANGS_PER_GUESSER,
  );
}
