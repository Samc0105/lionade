// Encode/decode a shift combo to a short URL-safe code you can share. The combo
// content (track, count, modifiers) is all ASCII, so base64url of compact JSON
// is plenty. Runs client-side only (uses btoa/atob).
//
// A combo can optionally carry a deterministic seed (Idea 14, shareable shift
// seeds). When present, the code reproduces one EXACT generated shift rather than
// a fresh draw of the same recipe: same items, same order, same mutators. The
// extra fields are written only when set, so a plain recipe code (no seed)
// stays byte for byte identical to the old format and existing combo links keep
// working unchanged.
//
// A seeded code can also carry a beat my desk challenge (Idea 29): the sharer's
// own score and grade, embedded under `vs`. Written only when a player turns a
// share into a challenge, so a plain seed or recipe code (no vs) round-trips byte
// for byte exactly as before. When a challenge code is opened the recipient plays
// the same exact shift and, on completion, sees a you versus them comparison.
//
// A code can also belong to a classroom challenge (Idea 33). A teacher embeds an
// optional class label under `l`, and the same seeded config the rest of the code
// already carries reproduces one exact shift for every student. When a student
// finishes, their paste back result code adds their name under `n` next to the
// existing `vs` score and grade, so a teacher can collect results by pasting them
// back, with no server. Both fields are written only when set, so a plain seed,
// recipe, or beat my desk code round trips byte for byte exactly as before.

import type { Track } from "@/lib/helpdesk/types";

/** The sharer's result, embedded in a beat my desk challenge code (Idea 29). */
export interface ChallengeVs {
  /** The sharer's shift score (0 to 100). */
  score: number;
  /** The sharer's letter grade for that score. */
  grade: string;
}

export interface ComboData {
  track?: Track;
  count: number;
  modifierIds: string[];
  /** Deterministic seed. When set, the code reproduces one exact shift. */
  seed?: number;
  /** Mutators were rolled in chaos mode (3 to 4 stacked) when re-rolled. */
  chaos?: boolean;
  /**
   * True when the mutators came from the seed roll, so reproducing means
   * re-rolling from the seed (which replays the same RNG stream and gives the
   * identical queue). False or absent means the modifierIds were hand picked and
   * are applied verbatim, as in a saved recipe combo.
   */
  rolled?: boolean;
  /**
   * Beat my desk challenge (Idea 29): the sharer's own score and grade. Present
   * only on a challenge code, so plain seed and recipe codes stay byte for byte
   * identical to before. The recipient plays the same exact shift and compares.
   */
  vs?: ChallengeVs;
  /**
   * Classroom challenge label (Idea 33), e.g. "Period 3 Networking". A teacher
   * sets it so every student sees the same class name on the shared shift. Written
   * only when set, so plain seed, recipe, and challenge codes round trip unchanged.
   */
  label?: string;
  /**
   * Classroom challenge student name (Idea 33), carried on a student's paste back
   * result code next to vs, so a teacher can attribute each result when collecting
   * them. Written only when set, so every code without it round trips unchanged.
   */
  student?: string;
}

function toUrlB64(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromUrlB64(s: string): string {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return atob(t);
}

export function encodeCombo(c: ComboData): string {
  try {
    // t/c/m are always written (recipe codes stay identical to the old format).
    // s/x/r are appended only for a seeded, exact shift code; v only for a
    // beat my desk challenge code (Idea 29); l/n only for a classroom challenge
    // (Idea 33).
    const o: { t: string; c: number; m: string[]; s?: number; x?: 1; r?: 1; v?: { s: number; g: string }; l?: string; n?: string } = {
      t: c.track ?? "",
      c: c.count,
      m: c.modifierIds,
    };
    if (c.seed != null) o.s = c.seed >>> 0;
    if (c.chaos) o.x = 1;
    if (c.rolled) o.r = 1;
    if (c.vs && Number.isFinite(c.vs.score)) {
      o.v = { s: Math.max(0, Math.min(100, Math.round(c.vs.score))), g: String(c.vs.grade ?? "") };
    }
    if (c.label && c.label.trim()) o.l = c.label.trim().slice(0, 48);
    if (c.student && c.student.trim()) o.n = c.student.trim().slice(0, 32);
    return toUrlB64(JSON.stringify(o));
  } catch {
    return "";
  }
}

export function decodeCombo(code: string): ComboData | null {
  try {
    const o = JSON.parse(fromUrlB64(code));
    if (!o || typeof o !== "object") return null;
    const seed = typeof o.s === "number" && Number.isFinite(o.s) ? o.s >>> 0 : undefined;
    // A challenge code (Idea 29) carries the sharer's score and grade under v.
    // Absent on every plain seed or recipe code, so they decode exactly as before.
    let vs: ChallengeVs | undefined;
    if (o.v && typeof o.v === "object" && typeof o.v.s === "number" && Number.isFinite(o.v.s)) {
      vs = {
        score: Math.max(0, Math.min(100, Math.round(o.v.s))),
        grade: typeof o.v.g === "string" ? o.v.g : "",
      };
    }
    // Classroom challenge fields (Idea 33). Absent on every plain seed, recipe, or
    // beat my desk code, so they decode exactly as before.
    const label = typeof o.l === "string" && o.l.trim() ? o.l.trim().slice(0, 48) : undefined;
    const student = typeof o.n === "string" && o.n.trim() ? o.n.trim().slice(0, 32) : undefined;
    return {
      track: o.t ? (o.t as Track) : undefined,
      count: typeof o.c === "number" ? Math.max(1, Math.min(12, o.c)) : 6,
      modifierIds: Array.isArray(o.m) ? (o.m as string[]).slice(0, 8) : [],
      seed,
      chaos: o.x === 1 || o.x === true ? true : undefined,
      rolled: o.r === 1 || o.r === true ? true : undefined,
      vs,
      label,
      student,
    };
  } catch {
    return null;
  }
}
