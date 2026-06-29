// Player-saved shift combos (track + count + chosen modifiers), local only.
//
// A SavedCombo is a named ComboData, so it reuses the exact same shape as a
// shareable code. That means a saved entry can also carry an optional seed
// (Idea 14): a player who received an exact shift link can keep it around and
// replay the identical queue later, not just a fresh draw of the recipe. The
// extra fields are optional, so existing saves and existing callers are
// unaffected (they simply omit them).

import type { ComboData } from "@/lib/liondesk/combocode";

export interface SavedCombo extends ComboData {
  name: string;
}

const KEY = "lionade.techhub.combos.v1";

export function getCombos(): SavedCombo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedCombo[]) : [];
  } catch {
    return [];
  }
}

function write(list: SavedCombo[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 24)));
  } catch {
    /* ignore */
  }
}

export function saveCombo(combo: SavedCombo): SavedCombo[] {
  const list = getCombos().filter((c) => c.name !== combo.name);
  list.unshift(combo);
  write(list);
  return list;
}

export function deleteCombo(name: string): SavedCombo[] {
  const list = getCombos().filter((c) => c.name !== name);
  write(list);
  return list;
}
