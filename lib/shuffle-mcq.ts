/**
 * Uniform-random shuffler for multiple-choice options.
 *
 * Large language models carry a strong positional bias when generating MCQs —
 * they tend to place the correct answer at index 0 (A) far more often than
 * random, and almost never at index 3 (D). Counted across the question bank
 * pre-fix: ~55% A, ~30% B, ~12% C, ~3% D. Sam's verbatim brief: "really 25%
 * yk." This module exists so every AI generation path can apply the same
 * uniform permutation before persisting.
 *
 * Algorithm: Fisher-Yates over an index array, then map both the options and
 * the correctIndex through the permutation. Math.random is fine — this is
 * not a security-sensitive shuffle, just a UX bias fix.
 *
 * Used by:
 *   - lib/mastery-content.ts (Mastery question generation — pre-existing).
 *   - app/api/ninny/generate/route.ts (Ninny multipleChoice + blitz — added
 *     2026-05-26 alongside the prompt-example fix in
 *     packages/lionade-core/src/prompts/ninny.ts).
 */

/**
 * Permutes a 4-tuple of options uniformly at random and returns the new
 * options array + the new index of the (still-correct) answer. Pure — does
 * not mutate the inputs.
 */
export function shuffleFour(
  options: [string, string, string, string],
  correctIndex: 0 | 1 | 2 | 3,
): { options: [string, string, string, string]; correctIndex: 0 | 1 | 2 | 3 } {
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffledOptions = indices.map((i) => options[i]) as [
    string,
    string,
    string,
    string,
  ];
  const newCorrectIndex = indices.indexOf(correctIndex) as 0 | 1 | 2 | 3;
  return { options: shuffledOptions, correctIndex: newCorrectIndex };
}

/**
 * Variable-length variant: shuffles any options array (must be >= 2 entries)
 * and returns the new correct index. Used for the Ninny path where the
 * generator can occasionally emit 3-option questions that survive validation.
 * For the strict 4-option Mastery path, prefer `shuffleFour`.
 */
export function shuffleOptions(
  options: string[],
  correctIndex: number,
): { options: string[]; correctIndex: number } {
  if (options.length < 2 || correctIndex < 0 || correctIndex >= options.length) {
    return { options, correctIndex };
  }
  const indices = options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffled = indices.map((i) => options[i]);
  const newCorrect = indices.indexOf(correctIndex);
  return { options: shuffled, correctIndex: newCorrect };
}
