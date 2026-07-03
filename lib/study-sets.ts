// Ninny Study Sets — shared server-side helpers for /api/study-sets/*.
//
// Owned by dev-backend. Routes import from here so validation rules, the AI
// deck schema, and card normalization stay in one place (route files may only
// export HTTP handlers).
//
// Schema reference: lib/migrations/20260702130000_study_sets.sql (HELD).
//
// FAIL-SOFT CONTRACT (until Sam applies the migration):
//   - /generate keeps working: it is a pure preview endpoint, nothing saved.
//   - Save/list/detail routes detect the missing tables via isMissingSchema
//     (lib/review-hub.ts) and return { notReady: true } with honest copy —
//     the pages degrade, they never 500.
//   - The Review Hub's study_set source contributes zero items silently
//     (see fetchStudySetQueue in lib/review-hub.ts).
//
// REWARD-FREE v1: study-set reviews follow the weak-spot precedent — no Fangs
// move anywhere in this feature, so no ledger types are needed.

import { z } from "zod";

// ── AI generation constants ──────────────────────────────────────────────────

// 12-factor #2 — prompt version tag. Bump on every prompt edit.
export const STUDY_SET_PROMPT_VERSION = "v1-2026-07-02";

/** Telemetry route key — also what the daily cap counts in ai_call_log. */
export const STUDY_SET_GEN_ROUTE = "study-sets/generate";

/** Per-user generations per UTC day (Ninny-cap pattern, tuned down for decks). */
export const STUDY_SET_GEN_DAILY_LIMIT = 10;

/** Input-size cap BEFORE any AI spend. 20 KB matches ninny/generate. */
export const STUDY_SET_MAX_INPUT_BYTES = 20 * 1024;

/** Optional steer-the-deck hint ("focus on the dates", "make it all MCQ"). */
export const STUDY_SET_MAX_HINT_LEN = 200;

// ── Deck/card limits ─────────────────────────────────────────────────────────

export const STUDY_SET_MAX_TITLE_LEN = 80;
export const STUDY_SET_MAX_DESCRIPTION_LEN = 200;
export const STUDY_SET_MAX_SUBJECT_LEN = 60;

/** AI preview cards are capped tighter than the DB columns (300 vs 500). */
export const STUDY_CARD_GEN_TEXT_MAX = 300;
/** User-edited cards may use the full DB budget. */
export const STUDY_CARD_TEXT_MAX = 500;
export const STUDY_CARD_OPTION_MAX = 300;

export const STUDY_SET_MIN_CARDS = 1;
export const STUDY_SET_MAX_CARDS = 30;

/** Honest degraded copy while the HELD migration is unapplied. No dashes. */
export const STUDY_SETS_NOT_READY_MSG =
  "Study sets are almost ready. Saving is waiting on a database update, so you can generate and preview decks but not keep them yet.";

// ── Zod schema for the AI deck (12-factor #4: validate at the trust boundary) ─

export const GeneratedCardSchema = z.object({
  type: z.enum(["flashcard", "mcq"]),
  front: z.string().min(1).max(STUDY_CARD_GEN_TEXT_MAX),
  back: z.string().min(1).max(STUDY_CARD_GEN_TEXT_MAX),
  options: z.array(z.string().min(1).max(STUDY_CARD_OPTION_MAX)).length(4).optional(),
  correct_index: z.number().int().min(0).max(3).optional(),
});

export const GeneratedDeckSchema = z.object({
  title: z.string().min(1).max(STUDY_SET_MAX_TITLE_LEN),
  cards: z.array(GeneratedCardSchema).min(8).max(20),
});

export type GeneratedDeck = z.infer<typeof GeneratedDeckSchema>;

export interface StudyCardInput {
  type: "flashcard" | "mcq";
  front: string;
  back: string;
  options: string[] | null;
  correct_index: number | null;
}

/**
 * Post-Zod cleanup for the AI preview: an "mcq" card that somehow lacks a
 * valid 4-option set (Zod marks options/correct_index optional) is coerced to
 * a plain flashcard instead of being dropped — front/back are always present.
 */
export function normalizeGeneratedCards(
  cards: GeneratedDeck["cards"],
): StudyCardInput[] {
  return cards.map((c) => {
    const front = c.front.trim().slice(0, STUDY_CARD_GEN_TEXT_MAX);
    const back = c.back.trim().slice(0, STUDY_CARD_GEN_TEXT_MAX);
    const validMcq =
      c.type === "mcq" &&
      Array.isArray(c.options) &&
      c.options.length === 4 &&
      c.options.every((o) => typeof o === "string" && o.trim().length > 0) &&
      typeof c.correct_index === "number" &&
      c.correct_index >= 0 &&
      c.correct_index <= 3;
    if (validMcq) {
      return {
        type: "mcq" as const,
        front,
        back,
        options: c.options!.map((o) => o.trim().slice(0, STUDY_CARD_OPTION_MAX)),
        correct_index: c.correct_index!,
      };
    }
    return { type: "flashcard" as const, front, back, options: null, correct_index: null };
  }).filter((c) => c.front.length > 0 && c.back.length > 0);
}

// ── Save-time validation (the user may have edited/trimmed the preview) ─────

export interface CardValidationError {
  error: string;
}

function isValidationError(v: unknown): v is CardValidationError {
  return typeof v === "object" && v !== null && "error" in (v as object);
}

/**
 * Validate + normalize a user-submitted card array for saving. Returns either
 * the cleaned cards or { error } with copy safe to surface to the client.
 */
export function validateCardsForSave(
  raw: unknown,
): StudyCardInput[] | CardValidationError {
  if (!Array.isArray(raw)) return { error: "Cards must be a list." };
  if (raw.length < STUDY_SET_MIN_CARDS) {
    return { error: "A deck needs at least 1 card." };
  }
  if (raw.length > STUDY_SET_MAX_CARDS) {
    return { error: `A deck can hold at most ${STUDY_SET_MAX_CARDS} cards.` };
  }

  const out: StudyCardInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Record<string, unknown> | null;
    if (!c || typeof c !== "object") return { error: `Card ${i + 1} is malformed.` };

    const type = c.type === "mcq" ? "mcq" : c.type === "flashcard" ? "flashcard" : null;
    if (!type) return { error: `Card ${i + 1} has an unknown type.` };

    const front = typeof c.front === "string" ? c.front.trim() : "";
    const back = typeof c.back === "string" ? c.back.trim() : "";
    if (front.length < 1 || front.length > STUDY_CARD_TEXT_MAX) {
      return { error: `Card ${i + 1}: the front must be 1 to ${STUDY_CARD_TEXT_MAX} characters.` };
    }
    if (back.length < 1 || back.length > STUDY_CARD_TEXT_MAX) {
      return { error: `Card ${i + 1}: the back must be 1 to ${STUDY_CARD_TEXT_MAX} characters.` };
    }

    if (type === "mcq") {
      const options = Array.isArray(c.options) ? c.options : null;
      if (
        !options ||
        options.length !== 4 ||
        !options.every((o) => typeof o === "string" && o.trim().length > 0 && o.trim().length <= STUDY_CARD_OPTION_MAX)
      ) {
        return { error: `Card ${i + 1}: multiple choice cards need exactly 4 non-empty options.` };
      }
      const ci = c.correct_index;
      if (typeof ci !== "number" || !Number.isInteger(ci) || ci < 0 || ci > 3) {
        return { error: `Card ${i + 1}: pick which option is correct.` };
      }
      out.push({
        type,
        front,
        back,
        options: (options as string[]).map((o) => o.trim()),
        correct_index: ci,
      });
    } else {
      out.push({ type, front, back, options: null, correct_index: null });
    }
  }
  return out;
}

export function isCardValidationError(
  v: StudyCardInput[] | CardValidationError,
): v is CardValidationError {
  return isValidationError(v);
}

// ── Misc field normalizers ───────────────────────────────────────────────────

export function normalizeTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length < 1 || t.length > STUDY_SET_MAX_TITLE_LEN) return null;
  return t;
}

export function normalizeDescription(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, STUDY_SET_MAX_DESCRIPTION_LEN);
}

export function normalizeSubject(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, STUDY_SET_MAX_SUBJECT_LEN);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
