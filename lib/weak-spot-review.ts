// Weak-Spot Review — spaced-repetition scheduling for the "Review your weak
// spots" quiz mode.
//
// Source of truth is the `ninny_wrong_answers` table:
//   (user_id, material_id, question_text, correct_answer, miss_count, last_seen_at)
//
// The base schema has NO dedicated SR columns (interval / ease / streak). This
// module is written so the scheduler works TODAY off `miss_count` + `last_seen_at`
// alone, and TRANSPARENTLY upgrades in two tiers as the HELD migrations land:
//
//   tier "leitner" (20260701120000): `review_streak` + `review_interval_days`
//     — Leitner boxes with an explicit streak.
//   tier "sm2" (20260702100000): adds `ease_factor` + `next_due_at`
//     — true SM-2. Ease moves +0.1 on a correct review / -0.2 on a wrong one
//     (clamped 1.30..5.00, mirroring lib/vocab.ts sm2Advance) and SCALES the
//     Leitner base interval; next_due_at is written explicitly on each grade
//     and, when present, wins over the derived schedule. next_due_at is
//     backfilled lazily: NULL rows simply use the derived math.
//
// Callers pass whatever columns they successfully read; missing ones are
// treated as undefined and the fallback math kicks in.
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
  /** Optional (HELD 20260701120000): consecutive correct reviews. */
  review_streak?: number | null;
  /** Optional (HELD 20260701120000): explicit next-interval in days. */
  review_interval_days?: number | null;
  /** Optional (HELD 20260702100000): SM-2 ease factor, 1.30..5.00. */
  ease_factor?: number | null;
  /** Optional (HELD 20260702100000): explicit next-due timestamp. */
  next_due_at?: string | null;
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

// ── SM-2 (HELD migration 20260702100000) ────────────────────────────────────
// Ease semantics mirror lib/vocab.ts sm2Advance: +0.1 on correct, -0.2 on
// wrong, clamped 1.30..5.00. Rather than `ease ** reviewCount` (vocab's growth,
// tuned for long-lived decks), weak spots keep the Leitner box as the BASE
// interval and scale it by ease relative to the 2.5 default — the deck retires
// items at MASTERY_STREAK anyway, so intervals stay bounded by design.

export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_EASE = 5.0;
const EASE_GAIN_CORRECT = 0.1;
const EASE_LOSS_WRONG = 0.2;

/** Clamp an (possibly missing/garbage) ease value into the valid SM-2 range. */
export function clampEase(e: unknown): number {
  const n = typeof e === "number" && Number.isFinite(e) ? e : DEFAULT_EASE;
  return Math.min(MAX_EASE, Math.max(MIN_EASE, n));
}

/**
 * SM-2 interval in hours: the Leitner base (streak box × miss penalty) scaled
 * by ease/2.5. At the default ease this is EXACTLY the Leitner interval, so
 * the pre-migration fallback and the SM-2 path agree on ungraded rows.
 */
export function sm2IntervalHours(
  missCount: number,
  reviewStreak: number,
  easeFactor: number,
): number {
  const base = intervalHours(missCount, reviewStreak);
  return Math.max(1, Math.round(base * (clampEase(easeFactor) / DEFAULT_EASE)));
}

/** Internal: derived due-at (ms epoch), honoring next_due_at when present. */
function dueAtMs(row: WeakSpotRow): number | null {
  // SM-2 path: an explicit next_due_at (written on grade) wins outright.
  if (row.next_due_at) {
    const t = new Date(row.next_due_at).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (!row.last_seen_at) return null; // never scheduled — always due
  const last = new Date(row.last_seen_at).getTime();
  if (Number.isNaN(last)) return null;
  const hours = sm2IntervalHours(
    row.miss_count ?? 1,
    row.review_streak ?? 0,
    row.ease_factor ?? DEFAULT_EASE,
  );
  return last + hours * 3_600_000;
}

/**
 * Is this row DUE for review right now?
 * Due when next_due_at (SM-2, when present) or last_seen_at + interval has
 * elapsed. A null last_seen_at (never scheduled) is always due.
 */
export function isDue(row: WeakSpotRow, now = Date.now()): boolean {
  const dueAt = dueAtMs(row);
  if (dueAt === null) return true;
  return dueAt <= now;
}

/** Milliseconds until a not-yet-due row becomes due (0 if already due). */
export function msUntilDue(row: WeakSpotRow, now = Date.now()): number {
  const dueAt = dueAtMs(row);
  if (dueAt === null) return 0;
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
 *   - ease += 0.1 (SM-2, clamped 1.30..5.00)
 *   - if the new streak reaches MASTERY_STREAK, the item is mastered and should
 *     be DELETED (mastered=true) so it never resurfaces.
 *
 * WRONG:
 *   - streak resets to 0
 *   - miss_count += 1 (raises priority, shortens next interval)
 *   - ease -= 0.2 (SM-2, clamped) so this item keeps resurfacing faster
 *
 * In BOTH cases last_seen_at is bumped to now so the SR clock restarts.
 *
 * `nextIntervalDays` / `newEaseFactor` / `nextDueAtISO` are only PERSISTED when
 * the corresponding HELD migrations are applied; the fallback path ignores them
 * (interval is derived on read from streak+miss+ease). nextDueAtISO is null
 * when mastered (the row is deleted, there is no next due).
 */
export interface ReviewOutcome {
  correct: boolean;
  mastered: boolean;
  newMissCount: number;
  newReviewStreak: number;
  newEaseFactor: number;
  nextIntervalDays: number;
  nextDueAtISO: string | null;
  lastSeenAtISO: string;
}

export function gradeReview(
  row: Pick<WeakSpotRow, "miss_count" | "review_streak" | "ease_factor">,
  correct: boolean,
  now = Date.now(),
): ReviewOutcome {
  const prevStreak = row.review_streak ?? 0;
  const prevMiss = row.miss_count ?? 1;
  const prevEase = clampEase(row.ease_factor ?? DEFAULT_EASE);

  let newReviewStreak: number;
  let newMissCount: number;
  let newEaseFactor: number;
  let mastered = false;

  if (correct) {
    newReviewStreak = prevStreak + 1;
    newMissCount = Math.max(0, prevMiss - 1);
    newEaseFactor = clampEase(prevEase + EASE_GAIN_CORRECT);
    if (newReviewStreak >= MASTERY_STREAK) mastered = true;
  } else {
    newReviewStreak = 0;
    newMissCount = prevMiss + 1;
    newEaseFactor = clampEase(prevEase - EASE_LOSS_WRONG);
  }
  newEaseFactor = Number(newEaseFactor.toFixed(2));

  const nextHours = mastered
    ? 0
    : sm2IntervalHours(newMissCount, newReviewStreak, newEaseFactor);
  const nextIntervalDays = mastered ? 0 : Math.max(1, Math.round(nextHours / 24));
  const nextDueAtISO = mastered
    ? null
    : new Date(now + nextHours * 3_600_000).toISOString();

  return {
    correct,
    mastered,
    newMissCount,
    newReviewStreak,
    newEaseFactor,
    nextIntervalDays,
    nextDueAtISO,
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
