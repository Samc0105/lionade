// Campaign progress for LionDesk shifts. LOCAL ONLY (localStorage), display +
// unlock purposes. Real Fang/XP granting and cross-device progress happen
// server-side once the techhub_shift_completions migration is applied and the
// /api/techhub/shifts route is wired in. Never grant currency from the client.

import type { Track } from "@/lib/helpdesk/types";
import { shiftsForTrack } from "./shifts";
import { gradeFor, PASS_SCORE } from "./scoring";

const KEY = "lionade.techhub.campaign.v1";

export interface ShiftRecord { bestScore: number; plays: number; lastCsat: number }
type CampaignMap = Record<string, ShiftRecord>;

// The letter grade ladder and the pass threshold now live in the scoring single
// source of truth (./scoring). They are re-exported here so existing importers
// (components/liondesk/Campaign.tsx) keep importing them from this module
// unchanged, while the actual values stay in one place across the engine, the
// UI, and the server payout route.
export { gradeFor, PASS_SCORE };

function read(): CampaignMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as CampaignMap) : {};
  } catch {
    return {};
  }
}

function write(map: CampaignMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* best-effort */
  }
}

export function getRecord(shiftId: string): ShiftRecord | null {
  return read()[shiftId] ?? null;
}

export function getAllRecords(): CampaignMap {
  return read();
}

export function isShiftCleared(shiftId: string): boolean {
  const r = read()[shiftId];
  return !!r && r.bestScore >= PASS_SCORE;
}

/** Record a finished shift. Keeps the best score; bumps the play count. */
export function recordShift(shiftId: string, score: number, csat: number): ShiftRecord {
  const map = read();
  const prev = map[shiftId];
  const rec: ShiftRecord = {
    bestScore: Math.max(score, prev?.bestScore ?? 0),
    plays: (prev?.plays ?? 0) + 1,
    lastCsat: csat,
  };
  map[shiftId] = rec;
  write(map);
  return rec;
}

/** How many shifts in a track the player has cleared (drives rank). */
export function clearedCountForTrack(track: Track): number {
  const map = read();
  return shiftsForTrack(track).filter((s) => (map[s.id]?.bestScore ?? 0) >= PASS_SCORE).length;
}
