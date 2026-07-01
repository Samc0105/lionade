// Weak-Spot Review — spaced-repetition scheduling for the "Review your weak
// spots" quiz mode.
//
// Source of truth is the `ninny_wrong_answers` table:
//   (user_id, material_id, question_text, correct_answer, miss_count, last_seen_at)
//
// The base schema has NO dedicated SR columns (interval / ease / streak). This
// module is written so the scheduler works TODAY off `miss_count` + `last_seen_at`
// alone, and TRANSPARENTLY upgrades to a Leitner-box schedule IF the optional
// columns from the HELD migration (`review_streak`, `review_interval_days`) are
// present. Callers pass whatever columns they successfully read; missing ones
// are treated as undefined and the fallback math kicks in.
//
// No Fangs are ever granted here — review is deliberately reward-free so it can
// never be farmed (a user could otherwise miss-on-purpose then "review" to mint
// currency). Mastery removing the item from the deck IS the reward.

/** A row as read from ninny_wrong_answers (SR columns optional). */
export interface WeakSpotRow {
  id: string;
  material_id: string;
  question_text: string;
  correct_answer: string;
  miss_count: number;
  last_seen_at: string | null;
  /** Optional (HELD migration): consecutive correct reviews. */
  review_streak?: number | null;
  /** Optional (HELD migration): explicit next-interval in days. */
  review_interval_days?: number | null;
}

/**
 * Leitner box intervals in HOURS, indexed by how many times in a row the user
 * has answered this item correctly during review. Box 0 (fresh miss) is due
 * fast; each correct answer promotes to a longer interval. Past the last box
 * the item is considered mastered and is removed from the deck entirely.
 */
export const REVIEW_BOX_HOURS = [4, 24, 72, 168, 384] as const; // 4h, 1d, 3d, 7d, 16d
export const MASTERY_STREAK = REVIEW_BOX_HOURS.length; // 5 correct-in-a-row => mastered

/**
 * Interval (hours) until an item is due next, given its review streak and how
 * many times it has been missed. Higher miss_count nudges the interval SHORTER
 * so chronically-missed items resurface sooner even at the same streak.
 */
export function intervalHours(missCount: number, reviewStreak: number): number {
  const box = Math.max(0, Math.min(reviewStreak, REVIEW_BOX_HOURS.length - 1));
  const base = REVIEW_BOX_HOURS[box];
  // Each extra miss beyond the first shaves ~12% off the interval, floored at 40%.
  const missPenalty = Math.max(0.4, 1 - Math.max(0, missCount - 1) * 0.12);
  return Math.max(1, Math.round(base * missPenalty));
}

/**
 * Is this row DUE for review right now?
 * Due when last_seen_at + intervalHours(...) has elapsed. A null last_seen_at
 * (never scheduled) is always due.
 */
export function isDue(row: WeakSpotRow, now = Date.now()): boolean {
  if (!row.last_seen_at) return true;
  const streak = row.review_streak ?? 0;
  const last = new Date(row.last_seen_at).getTime();
  if (Number.isNaN(last)) return true;
  const dueAt = last + intervalHours(row.miss_count ?? 1, streak) * 3_600_000;
  return dueAt <= now;
}

/** Milliseconds until a not-yet-due row becomes due (0 if already due). */
export function msUntilDue(row: WeakSpotRow, now = Date.now()): number {
  if (!row.last_seen_at) return 0;
  const streak = row.review_streak ?? 0;
  const last = new Date(row.last_seen_at).getTime();
  if (Number.isNaN(last)) return 0;
  const dueAt = last + intervalHours(row.miss_count ?? 1, streak) * 3_600_000;
  return Math.max(0, dueAt - now);
}

/**
 * Priority score for ORDERING the due deck — most-urgent first.
 * More misses = higher priority; longer-overdue = higher priority.
 */
export function priorityScore(row: WeakSpotRow, now = Date.now()): number {
  const overdueMs = row.last_seen_at
    ? now - new Date(row.last_seen_at).getTime()
    : Number.MAX_SAFE_INTEGER;
  const overdueHours = Math.max(0, overdueMs) / 3_600_000;
  return (row.miss_count ?? 1) * 10 + Math.min(overdueHours, 240);
}

/**
 * Compute the next state of a row after a review grade.
 *
 * CORRECT:
 *   - streak += 1
 *   - miss_count -= 1 (never below 0)
 *   - if the new streak reaches MASTERY_STREAK, the item is mastered and should
 *     be DELETED (mastered=true) so it never resurfaces.
 *
 * WRONG:
 *   - streak resets to 0
 *   - miss_count += 1 (raises priority, shortens next interval)
 *
 * In BOTH cases last_seen_at is bumped to now so the SR clock restarts.
 *
 * `nextIntervalDays` is only meaningful when the HELD migration is applied; the
 * fallback path ignores it (interval is derived on read from streak+miss).
 */
export interface ReviewOutcome {
  correct: boolean;
  mastered: boolean;
  newMissCount: number;
  newReviewStreak: number;
  nextIntervalDays: number;
  lastSeenAtISO: string;
}

export function gradeReview(
  row: Pick<WeakSpotRow, "miss_count" | "review_streak">,
  correct: boolean,
  now = Date.now(),
): ReviewOutcome {
  const prevStreak = row.review_streak ?? 0;
  const prevMiss = row.miss_count ?? 1;

  let newReviewStreak: number;
  let newMissCount: number;
  let mastered = false;

  if (correct) {
    newReviewStreak = prevStreak + 1;
    newMissCount = Math.max(0, prevMiss - 1);
    if (newReviewStreak >= MASTERY_STREAK) mastered = true;
  } else {
    newReviewStreak = 0;
    newMissCount = prevMiss + 1;
  }

  const nextIntervalDays = mastered
    ? 0
    : Math.max(1, Math.round(intervalHours(newMissCount, newReviewStreak) / 24));

  return {
    correct,
    mastered,
    newMissCount,
    newReviewStreak,
    nextIntervalDays,
    lastSeenAtISO: new Date(now).toISOString(),
  };
}

// ─── Reconstructing real MCQs from stored misses ────────────────────────────
//
// ninny_wrong_answers stores only question_text + correct_answer (a STRING),
// NOT the original 4-option set. To re-serve a miss as a real 4-option MCQ we
// join back to ninny_materials.generated_content by material_id and match the
// question text against the material's multipleChoice / blitz arrays (which DO
// carry the full options[]). When a match is found we serve a real MCQ; when it
// is not (question came from a non-MCQ mode, or the material was regenerated),
// we fall back to a flashcard-style reveal (question -> tap to reveal the
// correct answer, self-graded honestly and re-verified server-side against the
// stored correct_answer).

export type ReviewItemKind = "mcq" | "flashcard";

export interface ReviewMcqItem {
  kind: "mcq";
  id: string; // ninny_wrong_answers row id
  materialId: string;
  materialTitle: string | null;
  question: string;
  options: string[];
  /** index of the correct option within `options` */
  correctIndex: number;
  explanation?: string;
  missCount: number;
}

export interface ReviewFlashcardItem {
  kind: "flashcard";
  id: string;
  materialId: string;
  materialTitle: string | null;
  question: string;
  correctAnswer: string;
  missCount: number;
}

export type ReviewItem = ReviewMcqItem | ReviewFlashcardItem;

interface MaterialLite {
  id: string;
  title: string | null;
  multipleChoice?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
  blitz?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Turn a due weak-spot row into a servable review item. Reconstructs a real
 * MCQ if the question is found in the material's MCQ/blitz banks; otherwise
 * returns a flashcard fallback. `correctIndex` is recomputed against the row's
 * stored correct_answer so a regenerated material can't silently mis-key it.
 */
export function buildReviewItem(row: WeakSpotRow, material: MaterialLite | undefined): ReviewItem {
  const banks = [
    ...(material?.multipleChoice ?? []),
    ...(material?.blitz ?? []),
  ];
  const match = banks.find((q) => norm(q.question) === norm(row.question_text));

  if (match && Array.isArray(match.options) && match.options.length >= 2) {
    // Re-derive the correct index from the STORED correct_answer where possible
    // (defends against a regenerated material re-keying the same question).
    let correctIndex = match.correctIndex;
    const byText = match.options.findIndex((o) => norm(o) === norm(row.correct_answer));
    if (byText >= 0) correctIndex = byText;
    // Clamp to a valid range as a final guard.
    if (correctIndex < 0 || correctIndex >= match.options.length) correctIndex = 0;
    return {
      kind: "mcq",
      id: row.id,
      materialId: row.material_id,
      materialTitle: material?.title ?? null,
      question: row.question_text,
      options: match.options,
      correctIndex,
      explanation: match.explanation,
      missCount: row.miss_count ?? 1,
    };
  }

  return {
    kind: "flashcard",
    id: row.id,
    materialId: row.material_id,
    materialTitle: material?.title ?? null,
    question: row.question_text,
    correctAnswer: row.correct_answer,
    missCount: row.miss_count ?? 1,
  };
}
