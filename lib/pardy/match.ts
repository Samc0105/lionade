/**
 * Lionade-Pardy answer matching.
 *
 * Algorithm (V1):
 *   1. Normalize both player answer and the candidate set:
 *      - lowercase
 *      - strip Jeopardy-style prefixes ("what is", "who is", "where is",
 *        "what are", "who are", "where are")
 *      - strip leading articles ("the", "a", "an")
 *      - strip diacritics (NFD → drop combining marks)
 *      - strip punctuation, except internal alphanumerics, periods between
 *        single letters (so "T.S. Eliot" -> "ts eliot"), and digits
 *      - collapse whitespace
 *   2. Exact string equality on the normalized form, against the canonical
 *      answer and every alternateAnswer.
 *
 * NO fuzzy/Levenshtein in V1. Jeopardy is supposed to reward correctness —
 * close-but-wrong should still be wrong. Authors can add explicit
 * `alternateAnswers` to cover synonyms / abbreviations / common spellings.
 *
 * V2 may add Damerau-Levenshtein with a tight distance cap (1 for short
 * answers, 2 for longer) behind a deck-level opt-in.
 */

import type { PardyTile } from "./decks";

const JEOPARDY_PREFIXES = [
  "what are",
  "what is",
  "who are",
  "who is",
  "where are",
  "where is",
  "when is",
  "when are",
];

const LEADING_ARTICLES = ["the ", "a ", "an "];

/**
 * Normalize a Pardy answer for comparison. Pure + deterministic.
 *
 * Exported for unit tests + reuse in client-side hint logic.
 */
export function normalizePardyAnswer(input: string): string {
  let s = input.trim().toLowerCase();

  // Strip Jeopardy-style prefix once (and optional trailing question mark on the prefix).
  for (const prefix of JEOPARDY_PREFIXES) {
    if (s.startsWith(prefix + " ")) {
      s = s.slice(prefix.length + 1);
      break;
    }
    // Sometimes players type "what is...?" with no space before the apostrophe.
    if (s.startsWith(prefix)) {
      const rest = s.slice(prefix.length);
      if (rest.length === 0 || rest.startsWith(" ")) {
        s = rest.trimStart();
        break;
      }
    }
  }

  // Strip diacritics: NFD then drop combining marks. Lets "García Márquez"
  // match "Garcia Marquez".
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Strip leading articles after prefix removal.
  for (const art of LEADING_ARTICLES) {
    if (s.startsWith(art)) {
      s = s.slice(art.length);
      break;
    }
  }

  // Replace dots-between-letters as a no-op separator (T.S. -> ts) but keep
  // other punctuation/whitespace handling separate.
  s = s.replace(/\./g, "");

  // Strip remaining punctuation, keeping alphanumerics + whitespace. We use
  // an ASCII-only character class because tsc's default target doesn't allow
  // the `u` flag with Unicode property escapes. Diacritics were already
  // stripped above (NFD + combining-mark removal), so ASCII letters cover the
  // residue. Non-Latin scripts in canonical answers are unsupported in V1.
  s = s.replace(/[^a-z0-9\s]/g, " ");

  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Returns true if `playerAnswer` matches the tile's canonical answer or any
 * of its alternateAnswers, after normalization.
 */
export function matchPardyAnswer(playerAnswer: string, tile: PardyTile): boolean {
  const normalized = normalizePardyAnswer(playerAnswer);
  if (normalized.length === 0) return false;
  const candidates = [tile.correctAnswer, ...(tile.alternateAnswers ?? [])];
  for (const c of candidates) {
    if (normalizePardyAnswer(c) === normalized) return true;
  }
  return false;
}
