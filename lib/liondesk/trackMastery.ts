// Per track mastery ranks and track completion for TechHub (Idea 37). Pure,
// read only computation layered on the same local stores the rest of TechHub
// already keeps (campaign records, concept mastery). It blends three signals
// into one 0..100 mastery percent per career track: how many of the track's
// shifts you have cleared, your average shift grade, and your mastery of the
// concepts that track exercises. The percent maps to a cosmetic rank tier
// (Unranked to Diamond), and a separate "complete" flag fires once every shift
// in the track is cleared at the passing score.
//
// Cosmetic and display only. Nothing here grants Fangs, talks to an API, or
// touches the economy (which stays server authoritative). The cosmetic a
// completed track implies (a top of ladder title badge) is preview only, in
// line with the held migration: no client side granting, ever.

import type { Track } from "@/lib/helpdesk/types";
import { TRACKS, getTrack } from "@/lib/helpdesk/tracks";
import { shiftsForTrack } from "./shifts";
import { PASS_SCORE, gradeFor } from "./scoring";
import { getAllRecords, type ShiftRecord } from "./campaignProgress";
import { getConceptMastery, type ConceptMasteryRow } from "./conceptMastery";
import { conceptForItem } from "./concepts";

export interface MasteryTier {
  id: string;
  name: string;
  /** Inclusive lower bound (0..100) for this tier. */
  min: number;
  /** Accent hex, from the dark interstellar palette. */
  color: string;
}

// Ascending ladder. A percent earns the highest tier whose `min` it meets. The
// thresholds put a fully cleared track (every shift passed) at Gold or better,
// with Platinum and Diamond reserved for high grades plus strong concept work.
export const MASTERY_TIERS: MasteryTier[] = [
  { id: "unranked", name: "Unranked", min: 0, color: "#6B7280" },
  { id: "bronze", name: "Bronze", min: 20, color: "#C08457" },
  { id: "silver", name: "Silver", min: 45, color: "#9DB4E0" },
  { id: "gold", name: "Gold", min: 68, color: "#FFD700" },
  { id: "platinum", name: "Platinum", min: 84, color: "#C9A2F2" },
  { id: "diamond", name: "Diamond", min: 95, color: "#22D3EE" },
];

/** The highest tier a 0..100 mastery percent reaches. */
export function tierForPct(pct: number): MasteryTier {
  let tier = MASTERY_TIERS[0];
  for (const t of MASTERY_TIERS) if (pct >= t.min) tier = t;
  return tier;
}

export interface TrackCosmetic {
  trackId: Track;
  /** The top of ladder title a completed track earns, e.g. "CTO". */
  title: string;
  /** Badge accent, the track color. */
  color: string;
}

/** The cosmetic title (top rung of the track's rank ladder) completing implies. */
export function getTrackCosmetic(track: Track): TrackCosmetic {
  const def = getTrack(track);
  const ranks = def?.ranks ?? [];
  const top = ranks.length > 0 ? ranks[ranks.length - 1].title : "Track Master";
  return { trackId: track, title: top, color: def?.color ?? "#FFD700" };
}

export interface TrackMastery {
  id: Track;
  name: string;
  color: string;
  /** Shifts in the track's campaign. */
  total: number;
  /** Shifts cleared at or above the passing score. */
  cleared: number;
  /** Shifts with any recorded attempt. */
  played: number;
  /** Average best score over played shifts, 0 when none played. */
  avgScore: number;
  /** Letter grade for avgScore. */
  avgGrade: string;
  /** Average mastery of this track's concepts, null when no data yet. */
  conceptPct: number | null;
  /** Blended 0..100 mastery percent. */
  pct: number;
  /** Rank tier for pct. */
  tier: MasteryTier;
  /** True once every shift in the track is cleared at passing. */
  complete: boolean;
  /** Cosmetic title a completed track implies (preview only, no Fangs). */
  cosmetic: TrackCosmetic;
}

// Weights for the blend. Cleared progress leads, grade and concept mastery
// refine it. Concept weight is dropped and the rest renormalized when the track
// has no concept data yet, so an early game player is not dragged down by a
// signal that has not been recorded.
const W_CLEARED = 0.5;
const W_GRADE = 0.3;
const W_CONCEPT = 0.2;

/** The distinct concepts a track's shifts exercise (chain follow ups skipped). */
function conceptsForTrack(track: Track): Set<string> {
  const set = new Set<string>();
  for (const shift of shiftsForTrack(track)) {
    for (const it of shift.items) {
      if (it.revealedBy) continue;
      set.add(conceptForItem(it));
    }
  }
  return set;
}

/**
 * Mastery for one track from injected stores. Pure: given the same records and
 * concept rows it always returns the same result, safe to call during SSR.
 */
export function trackMasteryFor(
  track: Track,
  records: Record<string, ShiftRecord>,
  conceptRows: ConceptMasteryRow[],
): TrackMastery {
  const def = getTrack(track);
  const shifts = shiftsForTrack(track);
  let cleared = 0;
  let played = 0;
  let scoreSum = 0;
  for (const s of shifts) {
    const r = records[s.id];
    if (!r) continue;
    played++;
    scoreSum += r.bestScore;
    if (r.bestScore >= PASS_SCORE) cleared++;
  }
  const total = shifts.length;
  const avgScore = played > 0 ? Math.round(scoreSum / played) : 0;

  // Average concept mastery across the concepts this track exercises, ignoring
  // concepts with no handled tickets yet.
  const rowByConcept = new Map<string, ConceptMasteryRow>(
    conceptRows.map((r): [string, ConceptMasteryRow] => [r.concept, r]),
  );
  let cpSum = 0;
  let cpN = 0;
  conceptsForTrack(track).forEach((c) => {
    const row = rowByConcept.get(c);
    if (row && row.pct !== null) {
      cpSum += row.pct;
      cpN++;
    }
  });
  const conceptPct = cpN > 0 ? Math.round(cpSum / cpN) : null;

  const clearedRatio = total > 0 ? cleared / total : 0;
  const gradeScore = played > 0 ? avgScore / 100 : 0;
  let weighted = clearedRatio * W_CLEARED + gradeScore * W_GRADE;
  let weight = W_CLEARED + W_GRADE;
  if (conceptPct !== null) {
    weighted += (conceptPct / 100) * W_CONCEPT;
    weight += W_CONCEPT;
  }
  const pct = weight > 0 ? Math.round((weighted / weight) * 100) : 0;

  return {
    id: track,
    name: def?.name ?? track,
    color: def?.color ?? "#FFD700",
    total,
    cleared,
    played,
    avgScore,
    avgGrade: gradeFor(avgScore),
    conceptPct,
    pct,
    tier: tierForPct(pct),
    complete: total > 0 && cleared === total,
    cosmetic: getTrackCosmetic(track),
  };
}

/** Mastery for every track from injected stores. Pure. */
export function allTrackMastery(
  records: Record<string, ShiftRecord>,
  conceptRows: ConceptMasteryRow[],
): TrackMastery[] {
  return TRACKS.map((t) => trackMasteryFor(t.id, records, conceptRows));
}

/**
 * Convenience reader: mastery for every track from the live local stores.
 * Client intended (reads localStorage via the store readers); returns all zeros
 * during SSR, so callers still mount guard before showing the numbers.
 */
export function getAllTrackMastery(): TrackMastery[] {
  return allTrackMastery(getAllRecords(), getConceptMastery());
}

/** How many tracks are complete (every shift cleared at passing). */
export function completedTrackCount(masteries: TrackMastery[]): number {
  return masteries.filter((m) => m.complete).length;
}

/** Zeroed placeholders so a surface has shape before mount, never a row of zeros. */
export function trackMasterySkeleton(): TrackMastery[] {
  return TRACKS.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    total: shiftsForTrack(t.id).length,
    cleared: 0,
    played: 0,
    avgScore: 0,
    avgGrade: "D",
    conceptPct: null,
    pct: 0,
    tier: MASTERY_TIERS[0],
    complete: false,
    cosmetic: getTrackCosmetic(t.id),
  }));
}
