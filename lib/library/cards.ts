/**
 * Schema-tolerant helpers over study_cards rows.
 *
 * The card table is defined by the parallel dev-database migration
 * (20260702130000_study_sets.sql: study_cards with front/back, an optional
 * jsonb `options` array for MCQs, and vocab_words-style SM-2 state). Both
 * helpers work off `select("*")` rows so column drift degrades instead of
 * breaking:
 *
 *   - extractCardText: pulls every KNOWN content field that exists on the row
 *     (publish moderation input).
 *   - buildClonedCardRow: copies content columns verbatim, drops system
 *     columns, and OMITS spaced-repetition state columns entirely so the
 *     clone lands with the schema's own fresh-card defaults (ease 2.5,
 *     next_due_at now, counts 0 — the defaults dev-database gives a
 *     just-created card). Omission instead of explicit values means we can't
 *     42703 on a column that doesn't exist or violate a CHECK we can't see.
 */

export type CardRow = Record<string, unknown>;

/** Content fields we moderate on publish, in the order they'd read naturally. */
const CARD_TEXT_FIELDS = [
  "front",
  "back",
  "term",
  "definition",
  "question",
  "answer",
  "hint",
  "example",
  "notes",
] as const;

/** Never copied onto a clone — identity/lineage/timestamps. */
const SYSTEM_CARD_FIELDS = new Set(["id", "set_id", "user_id", "created_at", "updated_at"]);

/**
 * Omitted from clones so DB defaults produce a FRESH SM-2 state. Covers the
 * naming used across the existing SR schemas (vocab_words, ninny_wrong_answers,
 * 20260702100000_review_hub_sm2) plus obvious variants.
 */
const SR_STATE_FIELDS = new Set([
  "ease_factor",
  "ease",
  "next_due_at",
  "due_at",
  "last_reviewed_at",
  "reviewed_at",
  "last_seen_at",
  "review_count",
  "correct_count",
  "wrong_count",
  "incorrect_count",
  "miss_count",
  "review_streak",
  "streak",
  "lapses",
  "repetitions",
  "interval_days",
  "review_interval_days",
  "mastered",
  "learned",
]);

/** All human-authored text on a card (for publish moderation). */
export function extractCardText(row: CardRow): string[] {
  const out: string[] = [];
  for (const field of CARD_TEXT_FIELDS) {
    const v = row[field];
    if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
  }
  // MCQ answer options (jsonb string array) are user text too — a slur hidden
  // in a wrong answer must not slip past publish moderation.
  const options = row.options;
  if (Array.isArray(options)) {
    for (const opt of options) {
      if (typeof opt === "string" && opt.trim().length > 0) out.push(opt.trim());
    }
  }
  return out;
}

/**
 * A fresh insert payload for `newSetId` cloned from `row`. If the card schema
 * carries a per-row user_id (unknown until dev-database lands), it's re-pointed
 * at the cloner — only when the source row actually had the key, so we never
 * introduce a column the table lacks.
 */
export function buildClonedCardRow(
  row: CardRow,
  newSetId: string,
  newOwnerId: string,
): CardRow {
  const clone: CardRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (SYSTEM_CARD_FIELDS.has(key)) continue;
    if (SR_STATE_FIELDS.has(key)) continue;
    clone[key] = value;
  }
  clone.set_id = newSetId;
  if ("user_id" in row) clone.user_id = newOwnerId;
  return clone;
}
