// Player-saved shift combos (track + count + chosen modifiers), local only.

import type { Track } from "@/lib/helpdesk/types";

export interface SavedCombo {
  name: string;
  track?: Track;
  count: number;
  modifierIds: string[];
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
