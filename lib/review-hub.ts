// Review Hub — server-side helpers for the unified spaced-repetition queue.
//
// Merges DUE items from the four SR systems into one session:
//   1. Weak spots  — ninny_wrong_answers (lib/weak-spot-review.ts, SM-2/Leitner)
//   2. Vocab       — vocab_words (lib/vocab.ts sm2Advance, next_review_at)
//   3. Class cards — class_flashcards (lib/class-flashcards.ts applyRating)
//   4. Study sets  — study_cards (lib/study-sets.ts, vocab-style SM-2;
//                    HELD migration 20260702130000)
//
// GRADING IS NOT RE-IMPLEMENTED HERE. The Hub only READS due items; each item
// is graded through its source's existing endpoint (ninny/review/grade,
// vocab/review/[id], classes/[id]/flashcards/[cardId],
// study-sets/cards/[cardId]/review). This file also owns
// `logReviewEvent`, the cross-source outcome log those grade routes call.
//
// FAIL-SOFT RULES (every function in this file):
//   - A source that errors returns { ok: false, items: [], dueCount: 0 } — it
//     NEVER breaks the merged queue or 500s the route.
//   - review_events ships in HELD migration 20260702100000. Until Sam applies
//     it, logReviewEvent swallows the undefined-table error silently and
//     fetchRetention7d returns null (the UI hides the stat).
//
// No Fangs move in this file. The only reward-bearing path in the Hub is the
// EXISTING vocab grade route, which already owns its own ledger logic.

import { supabaseAdmin } from "@/lib/supabase-server";
import { isMissingSchema } from "@/lib/db/missing-schema";
import {
  buildReviewItem,
  isDue,
  msUntilDue,
  priorityScore,
  type ReviewItem,
  type WeakSpotRow,
} from "@/lib/weak-spot-review";

// ── Normalized queue item shapes ─────────────────────────────────────────────

export type ReviewEventSource = "weak_spot" | "vocab" | "class_flashcard" | "study_set";

export interface HubWeakSpotItem {
  source: "weak_spot";
  id: string;
  kind: "mcq" | "flashcard";
  question: string;
  /** MCQ only */
  options?: string[];
  /** MCQ only */
  correctIndex?: number;
  /** MCQ only */
  explanation?: string;
  /** Flashcard only */
  correctAnswer?: string;
  meta: { materialTitle: string | null; missCount: number };
}

export interface HubVocabItem {
  source: "vocab";
  id: string;
  kind: "vocab";
  /** The saved word/term (the card front). */
  question: string;
  /** The translation/definition (the card back). */
  correctAnswer: string;
  meta: {
    userDefinition: string | null;
    sourceLang: string | null;
    targetLang: string | null;
  };
}

export interface HubClassCardItem {
  source: "class_flashcard";
  id: string;
  kind: "rating";
  question: string;
  correctAnswer: string;
  /** classId is required by the client to build the grade PATCH URL. */
  meta: { classId: string; className: string | null };
}

export interface HubStudySetItem {
  source: "study_set";
  id: string;
  /** set_mcq renders 4 options; set_flashcard is a reveal + self-grade card. */
  kind: "set_mcq" | "set_flashcard";
  question: string;
  /** Flashcard: the back. MCQ: the explanation shown after answering. */
  correctAnswer: string;
  /** MCQ only */
  options?: string[];
  /** MCQ only */
  correctIndex?: number;
  meta: { setId: string; setTitle: string | null };
}

export type HubItem = HubWeakSpotItem | HubVocabItem | HubClassCardItem | HubStudySetItem;

export interface HubSourceResult {
  ok: boolean;
  items: HubItem[];
  dueCount: number;
  nextDueInMs: number | null;
}

// ── Missing-schema detection (HELD migrations) ──────────────────────────────
// Canonical implementation lives in lib/db/missing-schema.ts (shared by
// pacts, focus rooms, and the library guard). Re-exported here because the
// study-sets routes import it from this module for their notReady fail-soft.
export { isMissingSchema };

// ── review_events logging ────────────────────────────────────────────────────

/**
 * Record one review outcome. Fire-and-forget semantics: NEVER throws, never
 * affects the caller's response. Callers may `await` it (cheap single insert,
 * deterministic on serverless) — a failure is swallowed either way.
 *
 * Fail-soft: silently no-ops while the HELD 20260702100000 migration (the
 * review_events table) is unapplied.
 */
export async function logReviewEvent(
  userId: string,
  source: ReviewEventSource,
  correct: boolean,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("review_events")
      .insert({ user_id: userId, source, correct });
    if (error && !isMissingSchema(error)) {
      console.error("[review-hub] logReviewEvent:", error.message);
    }
  } catch {
    // Never propagate — the grade itself already succeeded.
  }
}

/**
 * 7-day retention stat from review_events. Returns null when the table is
 * missing (HELD migration unapplied) or unreadable — the UI hides the stat.
 */
export async function fetchRetention7d(
  userId: string,
): Promise<{ total: number; correct: number } | null> {
  try {
    const sinceISO = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [all, right] = await Promise.all([
      supabaseAdmin
        .from("review_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", sinceISO),
      supabaseAdmin
        .from("review_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("correct", true)
        .gte("created_at", sinceISO),
    ]);
    if (all.error || right.error) {
      const err = all.error ?? right.error;
      if (err && !isMissingSchema(err)) {
        console.error("[review-hub] retention:", err.message);
      }
      return null;
    }
    return { total: all.count ?? 0, correct: right.count ?? 0 };
  } catch {
    return null;
  }
}

// ── Source 1: weak spots ─────────────────────────────────────────────────────
// Tiered column detection: sm2 (20260702100000) → leitner (20260701120000) →
// base schema. A failed rich select simply retries the next tier down.

const WS_BASE_COLS = "id, material_id, question_text, correct_answer, miss_count, last_seen_at";
const WS_SR_COLS = `${WS_BASE_COLS}, review_streak, review_interval_days`;
const WS_SM2_COLS = `${WS_SR_COLS}, ease_factor, next_due_at`;

export interface WeakSpotQueueResult {
  ok: boolean;
  items: ReviewItem[];
  dueCount: number;
  totalWeakSpots: number;
  nextDueInMs: number | null;
}

/**
 * The full weak-spot due queue (rows → due filter → priority order → MCQ
 * reconstruction). Shared by GET /api/ninny/review (compat shape) and
 * GET /api/review/queue (hub shape via weakSpotToHubItem).
 */
export async function fetchWeakSpotQueue(
  userId: string,
  limit: number,
): Promise<WeakSpotQueueResult> {
  const empty: WeakSpotQueueResult = {
    ok: true,
    items: [],
    dueCount: 0,
    totalWeakSpots: 0,
    nextDueInMs: null,
  };
  try {
    // 1) Read the user's wrong-answer memory, richest column tier first.
    //    Only a MISSING-SCHEMA error (held column migration) steps a tier
    //    down — any other error surfaces as ok:false instead of silently
    //    degrading to a tier that drops the SM-2 scheduling columns.
    let rows: WeakSpotRow[] | null = null;
    for (const cols of [WS_SM2_COLS, WS_SR_COLS, WS_BASE_COLS]) {
      const res = await supabaseAdmin
        .from("ninny_wrong_answers")
        .select(cols)
        .eq("user_id", userId)
        .order("miss_count", { ascending: false })
        .limit(500);
      if (!res.error) {
        rows = (res.data ?? []) as unknown as WeakSpotRow[];
        break;
      }
      if (cols !== WS_BASE_COLS && isMissingSchema(res.error)) {
        continue; // held columns missing — try the next tier down
      }
      console.error("[review-hub] weak spots:", res.error.message);
      return { ...empty, ok: false };
    }

    const allRows = rows ?? [];
    if (allRows.length === 0) return empty;

    // 2) Split due / not-yet-due. Never re-drill not-due items (spacing is the
    //    whole point — see the 2026-07 note in the old /api/ninny/review).
    const now = Date.now();
    const dueRows = allRows.filter((r) => isDue(r, now));
    const notDue = allRows.filter((r) => !isDue(r, now));
    const nextDueInMs =
      notDue.length > 0 ? Math.min(...notDue.map((r) => msUntilDue(r, now))) : null;

    if (dueRows.length === 0) {
      return { ...empty, totalWeakSpots: allRows.length, nextDueInMs };
    }

    // 3) Most-urgent-first, session slice.
    const ordered = [...dueRows].sort((a, b) => priorityScore(b, now) - priorityScore(a, now));
    const slice = ordered.slice(0, limit);

    // 4) Reconstruct real MCQs from the source materials (ownership-guarded).
    const materialIds = Array.from(new Set(slice.map((r) => r.material_id)));
    const materialsById = new Map<
      string,
      {
        id: string;
        title: string | null;
        multipleChoice?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
        blitz?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
      }
    >();

    if (materialIds.length > 0) {
      const { data: mats } = await supabaseAdmin
        .from("ninny_materials")
        .select("id, user_id, title, generated_content")
        .in("id", materialIds)
        .eq("user_id", userId); // ownership guard
      for (const m of mats ?? []) {
        const gc = (m.generated_content ?? {}) as {
          multipleChoice?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
          blitz?: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
        };
        materialsById.set(m.id, {
          id: m.id,
          title: (m.title as string | null) ?? null,
          multipleChoice: Array.isArray(gc.multipleChoice) ? gc.multipleChoice : [],
          blitz: Array.isArray(gc.blitz) ? gc.blitz : [],
        });
      }
    }

    const items: ReviewItem[] = slice.map((row) =>
      buildReviewItem(row, materialsById.get(row.material_id)),
    );

    return {
      ok: true,
      items,
      dueCount: dueRows.length,
      totalWeakSpots: allRows.length,
      nextDueInMs,
    };
  } catch (err) {
    console.error("[review-hub] weak spots:", (err as Error).message);
    return { ...empty, ok: false };
  }
}

/** Adapt a weak-spot ReviewItem into the normalized hub shape. */
export function weakSpotToHubItem(item: ReviewItem): HubWeakSpotItem {
  if (item.kind === "mcq") {
    return {
      source: "weak_spot",
      id: item.id,
      kind: "mcq",
      question: item.question,
      options: item.options,
      correctIndex: item.correctIndex,
      explanation: item.explanation,
      meta: { materialTitle: item.materialTitle, missCount: item.missCount },
    };
  }
  return {
    source: "weak_spot",
    id: item.id,
    kind: "flashcard",
    question: item.question,
    correctAnswer: item.correctAnswer,
    meta: { materialTitle: item.materialTitle, missCount: item.missCount },
  };
}

// ── Source 2: vocab words ────────────────────────────────────────────────────

export async function fetchVocabQueue(
  userId: string,
  limit: number,
): Promise<HubSourceResult> {
  try {
    const nowISO = new Date().toISOString();
    const [due, upcoming] = await Promise.all([
      supabaseAdmin
        .from("vocab_words")
        .select("id, word, translation, user_definition, source_lang, target_lang", {
          count: "exact",
        })
        .eq("user_id", userId)
        .lte("next_review_at", nowISO)
        .order("next_review_at", { ascending: true })
        .limit(limit),
      supabaseAdmin
        .from("vocab_words")
        .select("next_review_at")
        .eq("user_id", userId)
        .gt("next_review_at", nowISO)
        .order("next_review_at", { ascending: true })
        .limit(1),
    ]);

    if (due.error) {
      if (!isMissingSchema(due.error)) {
        console.error("[review-hub] vocab:", due.error.message);
      }
      return { ok: false, items: [], dueCount: 0, nextDueInMs: null };
    }

    const items: HubItem[] = (due.data ?? []).map((w) => ({
      source: "vocab" as const,
      id: String(w.id),
      kind: "vocab" as const,
      question: String(w.word ?? ""),
      correctAnswer: String(w.translation ?? ""),
      meta: {
        userDefinition: (w.user_definition as string | null) ?? null,
        sourceLang: (w.source_lang as string | null) ?? null,
        targetLang: (w.target_lang as string | null) ?? null,
      },
    }));

    let nextDueInMs: number | null = null;
    const nextAt = upcoming.data?.[0]?.next_review_at as string | undefined;
    if (nextAt) {
      const t = new Date(nextAt).getTime();
      if (!Number.isNaN(t)) nextDueInMs = Math.max(0, t - Date.now());
    }

    return { ok: true, items, dueCount: due.count ?? items.length, nextDueInMs };
  } catch (err) {
    console.error("[review-hub] vocab:", (err as Error).message);
    return { ok: false, items: [], dueCount: 0, nextDueInMs: null };
  }
}

// ── Source 3: class flashcards (all classes) ────────────────────────────────

export async function fetchClassCardQueue(
  userId: string,
  limit: number,
): Promise<HubSourceResult> {
  try {
    const nowISO = new Date().toISOString();
    const [due, upcoming] = await Promise.all([
      supabaseAdmin
        .from("class_flashcards")
        .select("id, class_id, question, answer", { count: "exact" })
        .eq("user_id", userId)
        .eq("archived", false)
        .lte("next_due_at", nowISO)
        .order("next_due_at", { ascending: true })
        .limit(limit),
      supabaseAdmin
        .from("class_flashcards")
        .select("next_due_at")
        .eq("user_id", userId)
        .eq("archived", false)
        .gt("next_due_at", nowISO)
        .order("next_due_at", { ascending: true })
        .limit(1),
    ]);

    if (due.error) {
      if (!isMissingSchema(due.error)) {
        console.error("[review-hub] class cards:", due.error.message);
      }
      return { ok: false, items: [], dueCount: 0, nextDueInMs: null };
    }

    const rows = due.data ?? [];

    // Class name lookup for the card's context tag (ownership-scoped).
    const classIds = Array.from(new Set(rows.map((r) => String(r.class_id))));
    const namesById = new Map<string, string>();
    if (classIds.length > 0) {
      const { data: classes } = await supabaseAdmin
        .from("classes")
        .select("id, name")
        .in("id", classIds)
        .eq("user_id", userId);
      for (const c of classes ?? []) {
        namesById.set(String(c.id), String(c.name ?? ""));
      }
    }

    const items: HubItem[] = rows.map((r) => ({
      source: "class_flashcard" as const,
      id: String(r.id),
      kind: "rating" as const,
      question: String(r.question ?? ""),
      correctAnswer: String(r.answer ?? ""),
      meta: {
        classId: String(r.class_id),
        className: namesById.get(String(r.class_id)) ?? null,
      },
    }));

    let nextDueInMs: number | null = null;
    const nextAt = upcoming.data?.[0]?.next_due_at as string | undefined;
    if (nextAt) {
      const t = new Date(nextAt).getTime();
      if (!Number.isNaN(t)) nextDueInMs = Math.max(0, t - Date.now());
    }

    return { ok: true, items, dueCount: due.count ?? items.length, nextDueInMs };
  } catch (err) {
    console.error("[review-hub] class cards:", (err as Error).message);
    return { ok: false, items: [], dueCount: 0, nextDueInMs: null };
  }
}

// ── Source 4: study set cards ────────────────────────────────────────────────
// Ships in HELD migration 20260702130000. Unlike the other sources, a MISSING
// schema here returns ok:true with zero items (the feature simply is not live
// yet) so the hub does not show a permanent "source could not load" warning
// while Sam holds the migration. Real errors still return ok:false.

export async function fetchStudySetQueue(
  userId: string,
  limit: number,
  setId?: string | null,
): Promise<HubSourceResult> {
  const empty: HubSourceResult = { ok: true, items: [], dueCount: 0, nextDueInMs: null };
  try {
    const nowISO = new Date().toISOString();

    let dueQ = supabaseAdmin
      .from("study_cards")
      .select("id, set_id, type, front, back, options, correct_index", { count: "exact" })
      .eq("user_id", userId)
      .lte("next_due_at", nowISO)
      .order("next_due_at", { ascending: true })
      .limit(limit);
    let upcomingQ = supabaseAdmin
      .from("study_cards")
      .select("next_due_at")
      .eq("user_id", userId)
      .gt("next_due_at", nowISO)
      .order("next_due_at", { ascending: true })
      .limit(1);
    if (setId) {
      dueQ = dueQ.eq("set_id", setId);
      upcomingQ = upcomingQ.eq("set_id", setId);
    }

    const [due, upcoming] = await Promise.all([dueQ, upcomingQ]);

    if (due.error) {
      if (isMissingSchema(due.error)) return empty; // HELD migration unapplied
      console.error("[review-hub] study sets:", due.error.message);
      return { ...empty, ok: false };
    }

    const rows = due.data ?? [];

    // Deck title lookup for the card's context tag (ownership-scoped).
    const setIds = Array.from(new Set(rows.map((r) => String(r.set_id))));
    const titlesById = new Map<string, string>();
    if (setIds.length > 0) {
      const { data: sets } = await supabaseAdmin
        .from("study_sets")
        .select("id, title")
        .in("id", setIds)
        .eq("user_id", userId);
      for (const s of sets ?? []) {
        titlesById.set(String(s.id), String(s.title ?? ""));
      }
    }

    const items: HubItem[] = rows.map((r) => {
      const options = Array.isArray(r.options)
        ? (r.options as unknown[]).map((o) => String(o))
        : null;
      const ci = typeof r.correct_index === "number" ? r.correct_index : null;
      const isMcq =
        r.type === "mcq" && options !== null && options.length === 4 && ci !== null && ci >= 0 && ci <= 3;
      const base = {
        source: "study_set" as const,
        id: String(r.id),
        question: String(r.front ?? ""),
        correctAnswer: String(r.back ?? ""),
        meta: {
          setId: String(r.set_id),
          setTitle: titlesById.get(String(r.set_id)) ?? null,
        },
      };
      // A malformed mcq row degrades to a flashcard: front/back always render.
      return isMcq
        ? { ...base, kind: "set_mcq" as const, options: options!, correctIndex: ci! }
        : { ...base, kind: "set_flashcard" as const };
    });

    let nextDueInMs: number | null = null;
    const nextAt = upcoming.data?.[0]?.next_due_at as string | undefined;
    if (nextAt) {
      const t = new Date(nextAt).getTime();
      if (!Number.isNaN(t)) nextDueInMs = Math.max(0, t - Date.now());
    }

    return { ok: true, items, dueCount: due.count ?? items.length, nextDueInMs };
  } catch (err) {
    console.error("[review-hub] study sets:", (err as Error).message);
    return { ...empty, ok: false };
  }
}

// ── Interleave ───────────────────────────────────────────────────────────────

/**
 * Round-robin interleave across the per-source lists, capped at `cap`. Keeps a
 * session varied (weak spot, vocab, class card, weak spot, ...) instead of
 * grinding one source dry before the next starts.
 */
export function interleaveQueues(lists: HubItem[][], cap: number): HubItem[] {
  const out: HubItem[] = [];
  let i = 0;
  while (out.length < cap) {
    let pushed = false;
    for (const list of lists) {
      if (i < list.length) {
        out.push(list[i]);
        pushed = true;
        if (out.length >= cap) break;
      }
    }
    if (!pushed) break;
    i++;
  }
  return out;
}
