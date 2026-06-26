// TechHub progression — LOCAL ONLY (localStorage), display purposes.
//
// IMPORTANT: this tracks which sim tickets a player has cleared so the UI can
// show rank progress + unlock the next ticket. It does NOT touch the real Fangs
// economy. The economy is server-authoritative; the Fangs/XP shown on a resolve
// are cosmetic until a server route validates the solve and grants them. Never
// grant real currency from the client. See app/learn/techhub for the wiring
// note.

import type { Track } from "./types";

const KEY = "lionade.techhub.progress.v1";

type ProgressMap = Partial<Record<Track, string[]>>;

function read(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

function write(map: ProgressMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage full / disabled — progression is best-effort, never block play */
  }
}

export function getCleared(track: Track): string[] {
  return read()[track] ?? [];
}

export function getAllProgress(): ProgressMap {
  return read();
}

export function isCleared(track: Track, id: string): boolean {
  return getCleared(track).includes(id);
}

export function clearedCount(track: Track): number {
  return getCleared(track).length;
}

/** Mark a ticket cleared. Returns the new cleared list for that track. */
export function markCleared(track: Track, id: string): string[] {
  const map = read();
  const list = map[track] ?? [];
  if (!list.includes(id)) {
    map[track] = [...list, id];
    write(map);
    return map[track]!;
  }
  return list;
}

/** Total tickets cleared across every track. */
export function totalCleared(): number {
  const map = read();
  return Object.values(map).reduce((sum, list) => sum + (list?.length ?? 0), 0);
}
