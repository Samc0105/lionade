// Concept-level mastery for TechHub. Tracks how reliably the player handles each
// support concept (phishing, DNS, lockouts, ...) across completed shifts, so the
// Weak Spots review can target the concepts they fumble most. Local only: a
// personal practice signal, NOT the economy. Nothing here grants Fangs; the
// economy stays server-authoritative.

import type { Shift } from "./types";
import type { ShiftResult, State } from "./engine";
import { GOOD_STATUSES } from "./engine";
import { CONCEPTS, conceptForItem } from "./concepts";

export interface ConceptStat { correct: number; total: number }
type Store = Record<string, ConceptStat>;

const KEY = "lionade.techhub.conceptmastery.v1";

// Below this many handled tickets a concept is "still learning": its percentage
// exists but is too thin to rank as a confident weak spot.
export const MIN_CONCEPT_SAMPLES = 3;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? (p as Store) : {};
  } catch {
    return {};
  }
}
function save(s: Store): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export interface ConceptOutcome { concept: string; correct: boolean }

/**
 * Core recorder: fold a batch of per-item outcomes into the mastery store. This
 * is the integration point the play screens can call on completion (build the
 * outcomes from their final per-item statuses). Display only, grants nothing.
 */
export function recordConceptOutcomes(outcomes: ConceptOutcome[]): void {
  if (typeof window === "undefined" || outcomes.length === 0) return;
  const store = read();
  for (const o of outcomes) {
    if (!o.concept) continue;
    const cur = store[o.concept] ?? { correct: 0, total: 0 };
    store[o.concept] = { correct: cur.correct + (o.correct ? 1 : 0), total: cur.total + 1 };
  }
  save(store);
}

/**
 * Accurate per-item recorder for the play screens: fold a finished shift's final
 * statuses into concept mastery. A resolved/escalated/archived/reported item
 * counts as correct for its concept; a mishandled item counts as incorrect.
 * Items left open (still queued, or never revealed) carry no signal and are
 * skipped. Display only, grants nothing.
 */
export function recordShiftConcepts(shift: Shift, state: State): void {
  const outcomes: ConceptOutcome[] = [];
  for (const it of shift.items) {
    const st = state.items[it.id]?.status;
    if (!st || st === "queued") continue;
    outcomes.push({ concept: conceptForItem(it), correct: GOOD_STATUSES.includes(st) });
  }
  recordConceptOutcomes(outcomes);
}

/**
 * Estimate concept outcomes from a finished shift's ShiftResult, for surfaces
 * that only receive a ShiftResult (the review route gets one from LionDesk, not
 * the internal per-item state). Distributes the shift's resolved ratio across
 * the concepts present: for a concept with k base items, round(k * ratio) count
 * as correct out of k. An estimate, not the exact per-item record, but enough to
 * move the player's weak spots as they practice. Display only, grants nothing.
 */
export function recordShiftResultConcepts(shift: Shift, result: ShiftResult): void {
  const ratio = Math.min(1, Math.max(0, result.resolved / Math.max(1, result.total)));
  const counts: Record<string, number> = {};
  for (const it of shift.items) {
    if (it.revealedBy) continue; // chain follow-ups that may never have appeared
    const c = conceptForItem(it);
    counts[c] = (counts[c] ?? 0) + 1;
  }
  const outcomes: ConceptOutcome[] = [];
  for (const [concept, k] of Object.entries(counts)) {
    const correct = Math.round(k * ratio);
    for (let i = 0; i < k; i++) outcomes.push({ concept, correct: i < correct });
  }
  recordConceptOutcomes(outcomes);
}

export type MasteryLevel = "none" | "weak" | "ok" | "strong";

export interface ConceptMasteryRow {
  concept: string;
  label: string;
  correct: number;
  total: number;
  /** 0..100, or null when no tickets of this concept have been handled yet. */
  pct: number | null;
  /** Whether enough tickets have been handled to rank this confidently. */
  confident: boolean;
  level: MasteryLevel;
}

function bandFor(pct: number | null): MasteryLevel {
  if (pct === null) return "none";
  if (pct < 50) return "weak";
  if (pct < 80) return "ok";
  return "strong";
}

/** Mastery for every concept, in the taxonomy's display order. Client only. */
export function getConceptMastery(): ConceptMasteryRow[] {
  const store = read();
  return CONCEPTS.map((c) => {
    const s = store[c.id] ?? { correct: 0, total: 0 };
    const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : null;
    return {
      concept: c.id,
      label: c.label,
      correct: s.correct,
      total: s.total,
      pct,
      confident: s.total >= MIN_CONCEPT_SAMPLES,
      level: bandFor(pct),
    };
  });
}

/**
 * The player's weakest concept ids, weakest first, for biasing a Weak Spots
 * shift. Prefers concepts with enough samples to rank confidently; if none have
 * crossed the threshold yet, falls back to any concept with some data so a
 * focused review is still possible early. Returns [] when nothing is recorded,
 * in which case the generator falls back to a varied shift.
 */
export function getWeakestConcepts(n = 3): string[] {
  const rows = getConceptMastery().filter((r) => r.pct !== null);
  const confident = rows.filter((r) => r.confident);
  const pool = confident.length ? confident : rows;
  return [...pool]
    .sort((a, b) => (a.pct! - b.pct!) || (b.total - a.total))
    .slice(0, n)
    .map((r) => r.concept);
}

/** Whether any mastery data has been recorded yet (drives the empty state). */
export function hasMasteryData(): boolean {
  return Object.keys(read()).length > 0;
}

// Re-exported so the review surface can label targeted concepts without a second
// import of the taxonomy module.
export { conceptLabel } from "./concepts";
