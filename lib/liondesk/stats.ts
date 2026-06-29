// TechHub lifetime stats + achievements. Local only (display + goals). Shift
// results feed in via recordShiftResult; night data is read from the Night
// Shift stores. Achievements are derived, and newly-unlocked ones are returned
// so the UI can celebrate them.

import type { Shift } from "./types";
import type { ShiftResult } from "@/lib/liondesk/engine";
import { getMaxNightSurvived, getEndlessBest } from "./nightshift";
import { recordShiftReputation, getReputation, REP_DEPTS } from "./reputation";

const PASS = 50;

export interface TechhubStats {
  shiftsCleared: number;
  perfectShifts: number;
  doublesCleared: number;
  chaosCleared: number;
  skeletonWins: number;
  auditWins: number;
  tracksPlayed: string[];
  mutatorsSeen: string[];
  careerXp: number;
  bestShiftScore: number;
  weeklyCleared: boolean;
  hardCleared: boolean;
  selfMade: boolean;
  bestStreak: number;
}

const STATS_KEY = "lionade.techhub.stats.v1";
const UNLOCKED_KEY = "lionade.techhub.achievements.v1";

function emptyStats(): TechhubStats {
  return { shiftsCleared: 0, perfectShifts: 0, doublesCleared: 0, chaosCleared: 0, skeletonWins: 0, auditWins: 0, tracksPlayed: [], mutatorsSeen: [], careerXp: 0, bestShiftScore: 0, weeklyCleared: false, hardCleared: false, selfMade: false, bestStreak: 0 };
}

export function getStats(): TechhubStats {
  if (typeof window === "undefined") return emptyStats();
  try {
    const raw = window.localStorage.getItem(STATS_KEY);
    return raw ? { ...emptyStats(), ...JSON.parse(raw) } : emptyStats();
  } catch {
    return emptyStats();
  }
}
function saveStats(s: TechhubStats): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ── Run history ──
export interface HistoryEntry { kind: "shift" | "night"; label: string; detail: string; at: number }
const HISTORY_KEY = "lionade.techhub.history.v1";

export function getHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordHistoryEntry(e: HistoryEntry): void {
  if (typeof window === "undefined") return;
  try {
    const list = [e, ...getHistory()].slice(0, 20);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export interface Achievement { id: string; name: string; desc: string }
interface CheckCtx { stats: TechhubStats; maxNight: number; endlessBest: number; careerLevel: number; reputation: Record<string, number> }

const DEFS: (Achievement & { check: (c: CheckCtx) => boolean })[] = [
  { id: "first-day", name: "First Day", desc: "Clear your first shift.", check: (c) => c.stats.shiftsCleared >= 1 },
  { id: "survivor", name: "Survivor", desc: "Clear 10 shifts.", check: (c) => c.stats.shiftsCleared >= 10 },
  { id: "clean-sweep", name: "Clean Sweep", desc: "Finish a shift at 100% CSAT.", check: (c) => c.stats.perfectShifts >= 1 },
  { id: "incident-commander", name: "Incident Commander", desc: "Clear a Doubles shift.", check: (c) => c.stats.doublesCleared >= 1 },
  { id: "into-chaos", name: "Into the Chaos", desc: "Clear a Chaos shift (3+ mutators).", check: (c) => c.stats.chaosCleared >= 1 },
  { id: "no-net", name: "No Net", desc: "Win a Skeleton Crew shift (no hints).", check: (c) => c.stats.skeletonWins >= 1 },
  { id: "under-audit", name: "Under Audit", desc: "Win an Audit shift.", check: (c) => c.stats.auditWins >= 1 },
  { id: "generalist", name: "Generalist", desc: "Play all four tracks.", check: (c) => ["helpdesk", "soc", "swe", "redteam"].every((t) => c.stats.tracksPlayed.includes(t)) },
  { id: "mutated", name: "Mutated", desc: "See six different mutators.", check: (c) => c.stats.mutatorsSeen.length >= 6 },
  { id: "night-owl", name: "Night Owl", desc: "Survive a night.", check: (c) => c.maxNight >= 1 },
  { id: "dawn", name: "Dawn", desc: "Survive Night 6.", check: (c) => c.maxNight >= 6 },
  { id: "unkillable", name: "Unkillable", desc: "Last 3 minutes in Endless.", check: (c) => c.endlessBest >= 180 },
  { id: "promoted", name: "Promoted", desc: "Reach career level 5.", check: (c) => c.careerLevel >= 5 },
  { id: "score-hunter", name: "Score Hunter", desc: "Finish a shift with a 90+ score.", check: (c) => c.stats.bestShiftScore >= 90 },
  { id: "weekly-warrior", name: "Weekly Warrior", desc: "Clear a Weekly Challenge.", check: (c) => c.stats.weeklyCleared },
  { id: "trusted", name: "Trusted", desc: "Get a department to 90 reputation.", check: (c) => Object.values(c.reputation).some((v) => v >= 90) },
  { id: "beloved", name: "Beloved", desc: "Every department at 70 or above.", check: (c) => REP_DEPTS.every((d) => (c.reputation[d] ?? 50) >= 70) },
  { id: "iron-desk", name: "Iron Desk", desc: "Clear a shift on Hard.", check: (c) => c.stats.hardCleared },
  { id: "self-made", name: "Self-Made", desc: "Clear a Normal or Hard shift using no lifelines.", check: (c) => c.stats.selfMade },
  { id: "hot-streak", name: "Hot Streak", desc: "Hit a 6-resolve streak in one shift.", check: (c) => c.stats.bestStreak >= 6 },
];

export const ACHIEVEMENTS: Achievement[] = [
  ...DEFS.map(({ id, name, desc }) => ({ id, name, desc })),
  { id: "desk-legend", name: "Desk Legend", desc: "Unlock every other achievement." },
];

function ctx(): CheckCtx {
  return { stats: getStats(), maxNight: getMaxNightSurvived(), endlessBest: getEndlessBest(), careerLevel: getCareerLevel().level, reputation: getReputation() };
}

/** All achievement ids currently satisfied. */
export function computeUnlocked(): string[] {
  const c = ctx();
  const base = DEFS.filter((d) => d.check(c)).map((d) => d.id);
  if (base.length === DEFS.length) base.push("desk-legend");
  return base;
}

export function getUnlocked(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(UNLOCKED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Recompute, persist, and return ids unlocked since last time. */
function syncUnlocked(): string[] {
  const now = computeUnlocked();
  const prev = getUnlocked();
  const fresh = now.filter((id) => !prev.includes(id));
  if (fresh.length && typeof window !== "undefined") {
    try { window.localStorage.setItem(UNLOCKED_KEY, JSON.stringify(now)); } catch { /* ignore */ }
  }
  return fresh;
}

/** Record a finished shift. Returns newly-unlocked achievement ids. */
export function recordShiftResult(shift: Shift, r: ShiftResult): string[] {
  const cleared = r.score >= PASS;
  const s = getStats();
  let leveledTo = 0;
  if (cleared) {
    const before = levelForXp(s.careerXp);
    s.shiftsCleared++;
    s.careerXp += r.xp;
    if (shift.name === "Weekly Challenge") s.weeklyCleared = true;
    const after = levelForXp(s.careerXp);
    if (after > before) leveledTo = after;
  }
  s.bestShiftScore = Math.max(s.bestShiftScore, r.score);
  if (r.csat >= 100 && cleared) s.perfectShifts++;
  if (cleared && r.difficulty === "hard") s.hardCleared = true;
  if (cleared && r.difficulty !== "easy" && !r.usedLifeline) s.selfMade = true;
  s.bestStreak = Math.max(s.bestStreak, r.bestStreak);
  const modIds = (shift.modifiers ?? []).map((m) => m.id);
  for (const id of modIds) if (!s.mutatorsSeen.includes(id)) s.mutatorsSeen.push(id);
  if (!s.tracksPlayed.includes(shift.track)) s.tracksPlayed.push(shift.track);
  if (cleared && modIds.includes("doubles")) s.doublesCleared++;
  if (cleared && modIds.length >= 3) s.chaosCleared++;
  if (cleared && modIds.includes("skeleton")) s.skeletonWins++;
  if (cleared && modIds.includes("audit")) s.auditWins++;
  saveStats(s);
  recordShiftReputation(shift, r.csat);
  const mods = (shift.modifiers ?? []).map((m) => m.label);
  recordHistoryEntry({ kind: "shift", label: shift.name, detail: `${r.grade} · ${r.csat}% CSAT${mods.length ? " · " + mods.join(", ") : ""}`, at: Date.now() });
  const fresh = syncUnlocked();
  if (leveledTo) fresh.push(`${LEVELUP_BANNER_PREFIX}${leveledTo}:${titleForLevel(leveledTo)}`);
  return fresh;
}

/** Called after a night ends so night-based achievements unlock promptly. */
export function refreshAchievements(): string[] {
  return syncUnlocked();
}

// ── Career level ──
// Everything you play feeds one XP pool with a rising title ladder. The titles
// and the level->title mapping are exported so the TechHub Saga (lib/liondesk/
// saga.ts) can hang a narrative chapter off each rung without redefining the
// ladder. The saga is cosmetic only and grants nothing.
export const CAREER_TITLES = [
  "Intern", "Help Desk Tech", "Support Specialist", "Sysadmin", "Network Admin",
  "Security Analyst", "Senior Engineer", "Team Lead", "IT Manager", "Director of IT", "TechHub CTO",
];

// Prefix for the level-up celebration id pushed onto the AchievementBanner ids
// (see recordShiftResult below). The full form is
// "levelup:<level>:<title>". saga.ts and AchievementBanner read it back through
// this shared constant so the producer and consumers stay in agreement.
export const LEVELUP_BANNER_PREFIX = "levelup:";

const STEP = 150;
function cumulativeFor(level: number): number {
  return (STEP * ((level - 1) * level)) / 2;
}

export interface CareerLevel { level: number; title: string; xp: number; intoLevel: number; forNext: number; pct: number }

function levelForXp(xp: number): number {
  let level = 1;
  while (cumulativeFor(level + 1) <= xp) level++;
  return level;
}
export function titleForLevel(level: number): string {
  return CAREER_TITLES[Math.min(level - 1, CAREER_TITLES.length - 1)];
}

export function getCareerLevel(): CareerLevel {
  const xp = getStats().careerXp;
  const level = levelForXp(xp);
  const base = cumulativeFor(level);
  const next = cumulativeFor(level + 1);
  const intoLevel = xp - base;
  const forNext = next - base;
  return { level, title: titleForLevel(level), xp, intoLevel, forNext, pct: forNext > 0 ? Math.round((intoLevel / forNext) * 100) : 100 };
}

/** Add career XP directly (Night Shift has no ShiftResult to derive it from). */
export function addCareerXp(amount: number): void {
  if (amount <= 0) return;
  const s = getStats();
  s.careerXp += Math.round(amount);
  saveStats(s);
}
