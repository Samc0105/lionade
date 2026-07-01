/**
 * Roardle — pure Wordle-style letter scorer.
 *
 * Platform-agnostic. No React, RN, DOM, or node:* imports.
 *
 * Split from the web scorer in app/games/page.tsx (getRowStatuses) so web
 * and iOS share ONE correct duplicate-letter algorithm. Before this, iOS
 * (app/games.tsx getLetterStatus) used the naive per-letter
 * `target.includes(guess[i])` check, which is WRONG for duplicates:
 *
 *   target "LEVEL", guess "EAGLE"
 *     naive  → both E's go "present" even though only one E is unmatched
 *     correct→ first E "present", second E "absent" (only one E left in pool)
 *
 * Standard Wordle scoring uses two passes:
 *   Pass 1 — greens (correct position) consume their letter from a pool.
 *   Pass 2 — yellows (present) only while the letter still has remaining
 *            count in the pool after greens are accounted for. Surplus
 *            duplicate guesses fall through to gray (absent).
 *
 * Inputs are expected pre-normalized to the SAME case (both upper or both
 * lower) and equal length — callers already uppercase + length-check the
 * guess before submit. We do not re-case here so the scorer stays pure.
 */

export type LetterStatus = "correct" | "present" | "absent";

/**
 * Score a full guess against the target with correct duplicate-letter
 * handling. Returns one status per index, aligned to `guess`.
 *
 * This is the canonical scorer — the per-index helper, keyboard map, and
 * VoiceOver row summary all derive from this so they can never disagree on
 * duplicates.
 */
export function getRoardleRowStatuses(
  guess: string,
  target: string,
): LetterStatus[] {
  const n = guess.length;
  const result: LetterStatus[] = new Array(n).fill("absent");

  // Count how many of each letter remain available in the target.
  const remaining: Record<string, number> = {};
  for (const ch of target) remaining[ch] = (remaining[ch] ?? 0) + 1;

  // Pass 1: greens consume their letter from the pool.
  for (let i = 0; i < n; i++) {
    const ch = guess[i];
    if (ch !== undefined && ch === target[i]) {
      result[i] = "correct";
      remaining[ch] = (remaining[ch] ?? 0) - 1;
    }
  }

  // Pass 2: yellows only while the letter still has remaining count.
  for (let i = 0; i < n; i++) {
    if (result[i] === "correct") continue;
    const ch = guess[i];
    if (ch !== undefined && (remaining[ch] ?? 0) > 0) {
      result[i] = "present";
      remaining[ch] = (remaining[ch] ?? 0) - 1;
    }
  }

  return result;
}

/**
 * Status of a single tile. Thin wrapper over {@link getRoardleRowStatuses}
 * — DO NOT reimplement per-letter, or duplicates break (the bug this file
 * exists to kill). Callers that score a whole row repeatedly should call
 * getRoardleRowStatuses once and index into it instead of calling this in a
 * loop (avoids re-scoring the row per tile).
 */
export function getLetterStatus(
  guess: string,
  target: string,
  idx: number,
): LetterStatus {
  return getRoardleRowStatuses(guess, target)[idx] ?? "absent";
}

/**
 * Best-known keyboard color across all guesses so far: green > yellow >
 * gray > unused. Built from {@link getRoardleRowStatuses} so the on-screen
 * keyboard agrees with the grid on duplicate letters.
 */
export function getRoardleKeyboardStatus(
  guesses: string[],
  target: string,
): Record<string, LetterStatus | "unused"> {
  const map: Record<string, LetterStatus | "unused"> = {};
  "QWERTYUIOPASDFGHJKLZXCVBNM".split("").forEach((l) => (map[l] = "unused"));
  for (const guess of guesses) {
    const statuses = getRoardleRowStatuses(guess, target);
    for (let i = 0; i < guess.length; i++) {
      const s = statuses[i];
      const letter = guess[i];
      if (letter === undefined) continue;
      if (s === "correct") map[letter] = "correct";
      else if (s === "present" && map[letter] !== "correct") map[letter] = "present";
      else if (s === "absent" && map[letter] === "unused") map[letter] = "absent";
    }
  }
  return map;
}
