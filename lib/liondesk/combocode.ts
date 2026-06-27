// Encode/decode a shift combo to a short URL-safe code you can share. The combo
// content (track, count, modifiers) is all ASCII, so base64url of compact JSON
// is plenty. Runs client-side only (uses btoa/atob).

import type { Track } from "@/lib/helpdesk/types";

export interface ComboData {
  track?: Track;
  count: number;
  modifierIds: string[];
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
    return toUrlB64(JSON.stringify({ t: c.track ?? "", c: c.count, m: c.modifierIds }));
  } catch {
    return "";
  }
}

export function decodeCombo(code: string): ComboData | null {
  try {
    const o = JSON.parse(fromUrlB64(code));
    if (!o || typeof o !== "object") return null;
    return {
      track: o.t ? (o.t as Track) : undefined,
      count: typeof o.c === "number" ? Math.max(1, Math.min(12, o.c)) : 6,
      modifierIds: Array.isArray(o.m) ? (o.m as string[]).slice(0, 8) : [],
    };
  } catch {
    return null;
  }
}
