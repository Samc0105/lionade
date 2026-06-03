// Vocab feature — shared server-side helpers for /api/vocab/*.
//
// Owned by dev-backend. Routes import from here so the validation rules,
// SM-2 algorithm, and language allowlist stay in one place.
//
// Schema reference: supabase/migrations/20260603090250_vocab_words.sql
// (dev-database). Streak advancement is handled server-side via the
// `advance_vocab_streak` RPC (supabase/migrations/20260603100000_vocab_backend_support.sql).

// ── Language allowlist (V1: Spanish ↔ English only) ─────────────────────────
//
// Keeping this short is the cheapest abuse-control mechanism: it caps every
// translation request at one of 2 valid pairs (en→es, es→en) and rejects
// everything else before we even hit MyMemory. Expand here when we add
// more languages. The DB still allows any ISO-639-1 pair (regex `^[a-z]{2}$`)
// so growth doesn't require a migration.
export const SUPPORTED_LANGS = ["en", "es"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

export function isSupportedLang(v: unknown): v is SupportedLang {
  return typeof v === "string" && (SUPPORTED_LANGS as readonly string[]).includes(v);
}

/** Build the canonical "es-en" style pair key used by the streak GET response. */
export function langPairKey(source: SupportedLang, target: SupportedLang): string {
  return `${source}-${target}`;
}

// ── Word normalization ──────────────────────────────────────────────────────
//
// 50-char cap blocks paragraph submissions that would burn the MyMemory free
// tier (~500 chars/req max anyway). Whitespace normalization keeps cache hits
// high ("hola " and "  hola" map to the same key).
//
// NOTE: the DB allows up to 120 chars on `word` (schema constraint). We cap
// at 50 in the API layer specifically to keep MyMemory quota usage tight
// for V1 — a future migration can raise both ceilings together if needed.
export const MAX_WORD_LEN = 50;

export interface NormalizedWord {
  display: string; // trimmed + single-spaced, original case (what we save)
  cacheKey: string; // lowercased, used for the translation cache lookup
}

export function normalizeWord(input: unknown): NormalizedWord | null {
  if (typeof input !== "string") return null;
  const display = input.trim().replace(/\s+/g, " ");
  if (!display) return null;
  if (display.length > MAX_WORD_LEN) return null;
  return { display, cacheKey: display.toLocaleLowerCase() };
}

// ── User definition ────────────────────────────────────────────────────────
//
// User-supplied note attached to the saved card. DB allows up to 1000 chars
// (schema check). We cap at 500 in the API layer so a single row can't bloat
// the table; pre-stored, no AI cost — purely a row-size guard.
export const MAX_USER_DEFINITION_LEN = 500;

export function normalizeUserDefinition(input: unknown): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, MAX_USER_DEFINITION_LEN);
}

// ── Translation length cap (DB allows up to 400) ───────────────────────────
export const MAX_TRANSLATION_LEN = 200;

// ── SM-2 spaced repetition ─────────────────────────────────────────────────
//
// Simplified SM-2 per spec:
//   correct: ease += 0.1 (min 1.3), next = now + days(ease ** reviewCount)
//   wrong:   ease -= 0.2 (min 1.3), next = now + 10min
//
// `reviewCountAfter` is the count AFTER this review (we pass the
// incremented value in so the interval grows with each successful review).
// DB constraint: ease_factor between 1.30 and 5.00.

const MIN_EASE = 1.3;
const MAX_EASE = 5.0;
const WRONG_REVIEW_DELAY_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SM2Input {
  correct: boolean;
  easeFactor: number;
  reviewCountAfter: number; // post-increment review count
}

export interface SM2Result {
  easeFactor: number;
  nextReviewAt: string; // ISO string
}

export function sm2Advance({ correct, easeFactor, reviewCountAfter }: SM2Input): SM2Result {
  const base = Number.isFinite(easeFactor) && easeFactor >= MIN_EASE ? easeFactor : 2.5;
  let nextEase: number;
  let nextDeltaMs: number;
  if (correct) {
    nextEase = Math.min(MAX_EASE, Math.max(MIN_EASE, base + 0.1));
    // ease ** reviewCount can explode for big review counts — clamp the
    // exponent so a 30+ successful run doesn't schedule reviews 100 years out.
    const exponent = Math.min(Math.max(reviewCountAfter, 1), 12);
    const days = Math.min(Math.pow(nextEase, exponent), 365);
    nextDeltaMs = days * DAY_MS;
  } else {
    nextEase = Math.min(MAX_EASE, Math.max(MIN_EASE, base - 0.2));
    nextDeltaMs = WRONG_REVIEW_DELAY_MS;
  }
  return {
    easeFactor: Number(nextEase.toFixed(4)),
    nextReviewAt: new Date(Date.now() + nextDeltaMs).toISOString(),
  };
}

/** UTC "YYYY-MM-DD" for today — exported so routes can scope queries. */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
