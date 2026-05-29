// Server-side Wordle-style letter-position reveal for Sketchy Subjects.
//
// ── THE SECURITY CONTRACT ──
// The SECRET word never leaves the server. Guesser clients receive:
//   1. A structural MASK of the word: per display-position, either a blank box
//      to fill ("letter") or a shown separator like a space/hyphen ("fixed").
//      This reveals word LENGTH and punctuation only — intended per spec.
//   2. The set of POSITIONS that a submitted guess matched exactly (the green
//      squares), each paired with the letter the GUESSER ALREADY TYPED at that
//      position. We never return a letter for a position the guesser did not
//      match, so no unrevealed letter is ever shipped to a guesser client.
//
// Matching is by POSITION over the comparable (alphanumeric) characters, using
// the same normalization as guess grading so "DNA" vs "dna" etc. line up.

import { normalize } from "./levenshtein";

/** One display cell of the word as the guesser sees it. */
export interface MaskCell {
  /** "letter" = a fillable blank box; "fixed" = a shown separator char. */
  kind: "letter" | "fixed";
  /** For "fixed" cells, the literal char to show (space, hyphen, etc.). */
  char?: string;
}

/**
 * Build the guesser-facing structural mask of the secret word.
 * Letters/digits become blank boxes; everything else (spaces, hyphens,
 * apostrophes) is shown verbatim. Reveals length + punctuation only — NOT the
 * letters. Safe to send to every client.
 */
export function buildWordMask(secret: string): MaskCell[] {
  const cells: MaskCell[] = [];
  for (const ch of secret) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      cells.push({ kind: "letter" });
    } else {
      cells.push({ kind: "fixed", char: ch });
    }
  }
  return cells;
}

/** The index of each comparable (alphanumeric) char within the raw secret. */
function letterPositions(secret: string): number[] {
  const idxs: number[] = [];
  for (let i = 0; i < secret.length; i++) {
    if (/[a-zA-Z0-9]/.test(secret[i])) idxs.push(i);
  }
  return idxs;
}

export interface MatchedLetter {
  /** Display-position index into the MASK / raw secret string. */
  position: number;
  /** Comparable-letter index (ignoring spaces/punctuation), shared by guess
   *  and secret — used to green the matching letters in the guess text. */
  comparable: number;
  /** The matched letter (lowercased) — the guesser already typed this. */
  letter: string;
}

/**
 * Compare a raw guess against the secret by POSITION and return the matched
 * (green) display positions + their letters. ONLY exact-position matches are
 * returned; no information about non-matching positions leaks.
 *
 * We align on the comparable-letter sequence of each string (mirroring the
 * normalize() used for grading), then map each comparable index back to its
 * raw display position in the secret so the client can light up the right box.
 */
export function matchLetterPositions(guess: string, secret: string): MatchedLetter[] {
  const normSecret = normalize(secret).replace(/\s+/g, "");
  const normGuess = normalize(guess).replace(/\s+/g, "");
  if (!normSecret || !normGuess) return [];

  // Map comparable-index -> raw display position in the secret.
  const rawPositions = letterPositions(secret);

  const matched: MatchedLetter[] = [];
  const n = Math.min(normSecret.length, normGuess.length);
  for (let i = 0; i < n; i++) {
    if (normGuess[i] === normSecret[i]) {
      const rawPos = rawPositions[i];
      if (rawPos !== undefined) {
        matched.push({ position: rawPos, comparable: i, letter: normSecret[i] });
      }
    }
  }
  return matched;
}
