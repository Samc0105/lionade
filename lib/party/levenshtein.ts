// Fuzzy guess matching for Sketchy Subjects.
//
// We accept a guess as "correct" when it exactly matches the target word
// after normalization, and as "close" when the Levenshtein distance is 1 or 2.
// Distance > 2 is treated as wrong and never shown as feedback (we don't want
// to leak the target word through near-miss reactions).

export function normalize(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic Wagner-Fischer DP. Linear-space variant for small strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  // Early-out: if length gap exceeds threshold we already know distance > 2.
  if (Math.abs(m - n) > Math.max(m, n)) return Math.max(m, n);

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export type GuessVerdict = "correct" | "close" | "wrong";

/**
 * Compare a player's raw guess against the target word.
 * Returns:
 *   - "correct" if normalized guess equals the target
 *   - "close" if Levenshtein distance is 1 or 2 (typo tolerance)
 *   - "wrong" otherwise
 */
export function compareGuess(guess: string, target: string): GuessVerdict {
  const g = normalize(guess);
  const t = normalize(target);
  if (!g || !t) return "wrong";
  if (g === t) return "correct";
  const d = levenshtein(g, t);
  if (d <= 2) return "close";
  return "wrong";
}
