/**
 * Class Flashcards: AI generation hook + spaced-repetition math.
 *
 * Called fire-and-forget from the note-save POST. Failure here must NEVER
 * surface to the user — the note save has already succeeded. We log and
 * move on so a flaky AI call can't break the notebook.
 *
 * AI client: reuses `callAIForJson` (`lib/ai.ts`) which currently wraps
 * OpenAI gpt-4o-mini. Cheap, fast, JSON-mode reliable. If a Groq client
 * is added later, swap the model constant — the call surface is identical.
 */

import { supabaseAdmin } from "@/lib/supabase-server";
import { callAIForJson, LLM_CHEAP } from "@/lib/ai";

// ── Spaced-repetition constants (SM-2-ish) ───────────────────────────────────
// Defaults tuned for short, fact-shaped flashcards (vs longer concept cards).
// `ease` is multiplicative; lower = harder = shorter intervals.
export const SR_DEFAULT_EASE = 2.50;
export const SR_MIN_EASE = 1.30;
export const SR_MAX_INTERVAL_DAYS = 90;

// Per-rating tweaks
const EASE_DELTA_AGAIN = -0.20;
const EASE_DELTA_HARD  = -0.15;
const EASE_DELTA_EASY  =  0.15;

// Hard interval growth multiplier (stay close to current pace)
const HARD_INTERVAL_MULT = 1.2;
// Easy interval growth multiplier (jump further out)
const EASY_INTERVAL_MULT = 1.3;

export type FlashcardRating = "again" | "hard" | "good" | "easy";

export interface SrState {
  ease: number;
  intervalDays: number;
  nextDueAt: Date;
}

/**
 * Compute next SR state from current state + a rating. Pure function — does
 * not touch the DB. Caller is responsible for incrementing `reviews`.
 */
export function applyRating(
  current: { ease: number; intervalDays: number },
  rating: FlashcardRating,
  now: Date = new Date(),
): SrState {
  const ease0 = current.ease;
  const interval0 = Math.max(0, current.intervalDays | 0);

  let ease: number;
  let intervalDays: number;

  switch (rating) {
    case "again": {
      ease = clampEase(ease0 + EASE_DELTA_AGAIN);
      intervalDays = 1;
      break;
    }
    case "hard": {
      ease = clampEase(ease0 + EASE_DELTA_HARD);
      intervalDays = Math.max(1, Math.ceil(Math.max(1, interval0) * HARD_INTERVAL_MULT));
      break;
    }
    case "good": {
      ease = ease0; // unchanged
      const baseInterval = interval0 === 0 ? 1 : interval0;
      intervalDays = Math.ceil(baseInterval * ease);
      break;
    }
    case "easy": {
      ease = clampEase(ease0 + EASE_DELTA_EASY);
      const baseInterval = interval0 === 0 ? 1 : interval0;
      intervalDays = Math.ceil(baseInterval * ease * EASY_INTERVAL_MULT);
      break;
    }
  }

  intervalDays = Math.min(SR_MAX_INTERVAL_DAYS, Math.max(1, intervalDays));
  const nextDueAt = new Date(now.getTime() + intervalDays * 86_400_000);

  return { ease, intervalDays, nextDueAt };
}

function clampEase(e: number): number {
  if (!Number.isFinite(e)) return SR_DEFAULT_EASE;
  return Math.max(SR_MIN_EASE, Math.round(e * 100) / 100);
}

// ── AI generation ────────────────────────────────────────────────────────────
const MIN_NOTE_BODY_FOR_GEN = 80;
const MAX_NOTE_BODY_FOR_PROMPT = 4000;
const MAX_CARDS_PER_NOTE = 5;

interface RawCard {
  q?: unknown;
  a?: unknown;
}

/**
 * Fire-and-forget: generate up to 5 flashcards from a note's body and
 * persist them to `class_flashcards`. Safe to `void`-call from a route
 * handler — never throws to the caller.
 */
export async function generateFlashcardsForNote(args: {
  userId: string;
  classId: string;
  noteId: string;
  noteBody: string;
}): Promise<void> {
  try {
    const trimmed = args.noteBody.trim();
    if (trimmed.length < MIN_NOTE_BODY_FOR_GEN) return;

    const promptInput = trimmed.slice(0, MAX_NOTE_BODY_FOR_PROMPT);

    const { json } = await callAIForJson<{ cards: RawCard[] }>({
      model: LLM_CHEAP,
      maxTokens: 900,
      temperature: 0.4,
      timeoutMs: 20_000,
      system:
        "You are a study assistant building flashcards. Be terse and concrete. " +
        "Output ONLY a single JSON object. No preamble, no markdown. " +
        "If the note has no factual content worth turning into cards (e.g. it's a todo, a feeling, " +
        "a single sentence with no facts), return an empty array.",
      userContent:
`Generate up to ${MAX_CARDS_PER_NOTE} short flashcards from this study note.
Each card has a clear factual question and a 1-2 sentence answer.
Skip generic / vague material. Quality over quantity.

Return EXACTLY:
{"cards":[{"q":"...","a":"..."}]}

NOTE:
<note>
${promptInput}
</note>`,
    });

    const cards = Array.isArray(json?.cards) ? json.cards : [];
    const cleaned = cards
      .slice(0, MAX_CARDS_PER_NOTE)
      .map(c => ({
        q: typeof c?.q === "string" ? c.q.trim() : "",
        a: typeof c?.a === "string" ? c.a.trim() : "",
      }))
      .filter(c =>
        c.q.length >= 6 && c.q.length <= 280 &&
        c.a.length >= 2 && c.a.length <= 600
      );

    if (cleaned.length === 0) return;

    const now = new Date().toISOString();
    const rows = cleaned.map(c => ({
      user_id: args.userId,
      class_id: args.classId,
      source_note_id: args.noteId,
      question: c.q,
      answer: c.a,
      source: "ai_note" as const,
      ease: SR_DEFAULT_EASE,
      interval_days: 0,
      next_due_at: now,
      reviews: 0,
      archived: false,
    }));

    const { error } = await supabaseAdmin.from("class_flashcards").insert(rows);
    if (error) {
      console.error("[class-flashcards] insert:", error.message);
    }
  } catch (err) {
    console.error("[class-flashcards] generate:", (err as Error).message);
  }
}
