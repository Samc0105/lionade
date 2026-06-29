// Encode/decode a shift combo to a short URL-safe code you can share. The combo
// content (track, count, modifiers) is all ASCII, so base64url of compact JSON
// is plenty. Runs client-side only (uses btoa/atob).
//
// A combo can optionally carry a deterministic seed (Idea 14, shareable shift
// seeds). When present, the code reproduces one EXACT generated shift rather than
// a fresh draw of the same recipe: same items, same order, same mutators. The
// three extra fields are written only when set, so a plain recipe code (no seed)
// stays byte for byte identical to the old format and existing combo links keep
// working unchanged.

import type { Track } from "@/lib/helpdesk/types";

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
    // s/x/r are appended only for a seeded, exact shift code.
    const o: { t: string; c: number; m: string[]; s?: number; x?: 1; r?: 1 } = {
      t: c.track ?? "",
      c: c.count,
      m: c.modifierIds,
    };
    if (c.seed != null) o.s = c.seed >>> 0;
    if (c.chaos) o.x = 1;
    if (c.rolled) o.r = 1;
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
    return {
      track: o.t ? (o.t as Track) : undefined,
      count: typeof o.c === "number" ? Math.max(1, Math.min(12, o.c)) : 6,
      modifierIds: Array.isArray(o.m) ? (o.m as string[]).slice(0, 8) : [],
      seed,
      chaos: o.x === 1 || o.x === true ? true : undefined,
      rolled: o.r === 1 || o.r === true ? true : undefined,
    };
  } catch {
    return null;
  }
}
