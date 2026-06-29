// Rotating daily + weekly quests for TechHub. COSMETIC ONLY: clearing a quest
// grants a collectible badge, never Fangs and never XP. The economy stays
// server-authoritative (lib/liondesk/campaignProgress.ts has the same note), so
// nothing in this file touches currency.
//
// The quest SET is deterministic and shared: today's quests are picked with the
// same dateSeed daily.ts uses, and this week's with the same weekSeed the Weekly
// Challenge uses (both live in lib/liondesk/generate.ts). That means everyone
// sees the same objectives today, exactly like the Daily Combo and Weekly
// Challenge. Only your PROGRESS is personal.
//
// Progress is evaluated from data the game already tracks (lib/liondesk/stats.ts
// and lib/liondesk/dailyLog.ts), never from new instrumentation. Cumulative
// counters (shifts cleared, perfect shifts, skeleton wins, career XP, ...) are
// measured as a delta from a baseline snapshot captured when the quest period
// begins; "today" objectives (clear today's Daily Combo, hit a grade) read the
// per-day clock-in log directly. This local store keeps only those baselines and
// the badges you have earned, both keyed by the same UTC day-key the rest of the
// daily loop uses.

import { getStats } from "./stats";
import { getTodayStatus } from "./dailyLog";
import { dateSeed, weekSeed } from "./generate";

/* ───────────────────────── cosmetic badges ───────────────────────── */

export type QuestTier = "daily" | "weekly";

/** A collectible profile badge. Purely cosmetic, granted by clearing a quest. */
export interface QuestBadge {
  id: string;
  name: string;
  /** Accent color, drawn from the TechHub palette (gold, electric, purple, crimson). */
  color: string;
  /** What earning it commemorates (user-facing). */
  desc: string;
  tier: QuestTier;
}

const GOLD = "#FFD700";
const ELECTRIC = "#4A90D9";
const PURPLE = "#C9A2F2";
const CRIMSON = "#F87171";

export const QUEST_BADGES: QuestBadge[] = [
  // Daily badges.
  { id: "badge-clocked-in", name: "Clocked In", color: GOLD, desc: "Cleared a Daily Combo to open the day.", tier: "daily" },
  { id: "badge-double-shift", name: "Double Shift", color: ELECTRIC, desc: "Cleared two shifts in a single day.", tier: "daily" },
  { id: "badge-high-marks", name: "High Marks", color: GOLD, desc: "Finished a shared mode at grade A or better.", tier: "daily" },
  { id: "badge-spotless", name: "Spotless", color: ELECTRIC, desc: "Finished a shift at 100% CSAT.", tier: "daily" },
  { id: "badge-storm-rider", name: "Storm Rider", color: CRIMSON, desc: "Cleared a Daily Chaos gauntlet.", tier: "daily" },
  { id: "badge-flying-solo", name: "Flying Solo", color: PURPLE, desc: "Won a Skeleton Crew shift with no hints.", tier: "daily" },
  { id: "badge-root-cause", name: "Root Cause", color: CRIMSON, desc: "Traced an incident storm to its root.", tier: "daily" },
  { id: "badge-overtime", name: "Overtime", color: GOLD, desc: "Banked a full day of career XP.", tier: "daily" },
  // Weekly badges (the harder, week-long objectives).
  { id: "badge-iron-week", name: "Iron Week", color: GOLD, desc: "Cleared twelve shifts in one week.", tier: "weekly" },
  { id: "badge-flawless", name: "Flawless", color: ELECTRIC, desc: "Three perfect shifts in one week.", tier: "weekly" },
  { id: "badge-lone-wolf", name: "Lone Wolf", color: PURPLE, desc: "Two no hint wins in one week.", tier: "weekly" },
  { id: "badge-tempest", name: "Tempest", color: CRIMSON, desc: "Three Chaos shifts in one week.", tier: "weekly" },
  { id: "badge-marathon", name: "Marathon", color: GOLD, desc: "A full week of career XP.", tier: "weekly" },
];

export function getQuestBadge(id: string): QuestBadge | null {
  return QUEST_BADGES.find((b) => b.id === id) ?? null;
}

/* ───────────────────────── progress snapshot ───────────────────────── */

// Best to worst, mirrors the grade ladder used elsewhere (dailyLog, scoring).
const GRADE_RANK: Record<string, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };
const GRADE_A = GRADE_RANK.A;

// A flat reading of every value any quest objective measures. Counters come from
// lifetime stats; the "today" fields come from the per-day clock-in log.
interface Snap {
  shiftsCleared: number;
  perfectShifts: number;
  doublesCleared: number;
  chaosCleared: number;
  skeletonWins: number;
  careerXp: number;
  todayCombo: number; // 0 or 1
  todayChaos: number; // 0 or 1
  todayWeekly: number; // 0 or 1
  todayBestGradeRank: number; // 0..4, or -1 when nothing cleared today
}

function emptySnap(): Snap {
  return { shiftsCleared: 0, perfectShifts: 0, doublesCleared: 0, chaosCleared: 0, skeletonWins: 0, careerXp: 0, todayCombo: 0, todayChaos: 0, todayWeekly: 0, todayBestGradeRank: -1 };
}

function currentSnap(): Snap {
  if (typeof window === "undefined") return emptySnap();
  const s = getStats();
  const today = getTodayStatus();
  const clearedFlag = (mode: string) => (today.find((t) => t.mode === mode)?.cleared ? 1 : 0);
  const bestGrade = today
    .filter((t) => t.cleared && t.grade)
    .reduce((best, t) => Math.max(best, GRADE_RANK[t.grade as string] ?? -1), -1);
  return {
    shiftsCleared: s.shiftsCleared,
    perfectShifts: s.perfectShifts,
    doublesCleared: s.doublesCleared,
    chaosCleared: s.chaosCleared,
    skeletonWins: s.skeletonWins,
    careerXp: s.careerXp,
    todayCombo: clearedFlag("combo"),
    todayChaos: clearedFlag("chaos"),
    todayWeekly: clearedFlag("weekly"),
    todayBestGradeRank: bestGrade,
  };
}

/* ───────────────────────── quest templates ───────────────────────── */

interface QuestTemplate {
  id: string;
  tier: QuestTier;
  title: string;
  /** How to complete it (user-facing). */
  desc: string;
  target: number;
  /** Measure progress as (current minus baseline) when true; absolute when false. */
  relative: boolean;
  read: (s: Snap) => number;
  badgeId: string;
}

// Daily pool. Three are picked per calendar day. Every objective is backed by a
// real counter or by today's clock-in log, so it is achievable in a day and
// fairly readable by veterans and newcomers alike.
const DAILY_POOL: QuestTemplate[] = [
  { id: "d-clockin", tier: "daily", title: "Clock In", desc: "Clear today's Daily Combo.", target: 1, relative: false, read: (s) => s.todayCombo, badgeId: "badge-clocked-in" },
  { id: "d-double", tier: "daily", title: "Double Shift", desc: "Clear 2 shifts today.", target: 2, relative: true, read: (s) => s.shiftsCleared, badgeId: "badge-double-shift" },
  { id: "d-grade", tier: "daily", title: "High Marks", desc: "Finish a shared mode at grade A or better today.", target: 1, relative: false, read: (s) => (s.todayBestGradeRank >= GRADE_A ? 1 : 0), badgeId: "badge-high-marks" },
  { id: "d-perfect", tier: "daily", title: "Spotless", desc: "Finish a shift at 100% CSAT today.", target: 1, relative: true, read: (s) => s.perfectShifts, badgeId: "badge-spotless" },
  { id: "d-chaos", tier: "daily", title: "Into the Storm", desc: "Clear today's Daily Chaos.", target: 1, relative: false, read: (s) => s.todayChaos, badgeId: "badge-storm-rider" },
  { id: "d-skeleton", tier: "daily", title: "Flying Solo", desc: "Win a Skeleton Crew shift (no hints) today.", target: 1, relative: true, read: (s) => s.skeletonWins, badgeId: "badge-flying-solo" },
  { id: "d-incident", tier: "daily", title: "Root Cause", desc: "Resolve an incident storm (Doubles) today.", target: 1, relative: true, read: (s) => s.doublesCleared, badgeId: "badge-root-cause" },
  { id: "d-xp", tier: "daily", title: "Overtime", desc: "Earn 120 career XP today.", target: 120, relative: true, read: (s) => s.careerXp, badgeId: "badge-overtime" },
];

// Weekly pool. Two are picked per ISO week. Bigger asks that span several
// sittings, all measured as a delta so a fresh week always starts at zero.
const WEEKLY_POOL: QuestTemplate[] = [
  { id: "w-shifts", tier: "weekly", title: "Iron Week", desc: "Clear 12 shifts this week.", target: 12, relative: true, read: (s) => s.shiftsCleared, badgeId: "badge-iron-week" },
  { id: "w-perfect", tier: "weekly", title: "Flawless Week", desc: "Finish 3 shifts at 100% CSAT this week.", target: 3, relative: true, read: (s) => s.perfectShifts, badgeId: "badge-flawless" },
  { id: "w-skeleton", tier: "weekly", title: "Lone Wolf", desc: "Win 2 Skeleton Crew shifts (no hints) this week.", target: 2, relative: true, read: (s) => s.skeletonWins, badgeId: "badge-lone-wolf" },
  { id: "w-chaos", tier: "weekly", title: "Storm Chaser", desc: "Clear 3 Chaos shifts this week.", target: 3, relative: true, read: (s) => s.chaosCleared, badgeId: "badge-tempest" },
  { id: "w-xp", tier: "weekly", title: "Marathon", desc: "Earn 600 career XP this week.", target: 600, relative: true, read: (s) => s.careerXp, badgeId: "badge-marathon" },
];

const DAILY_COUNT = 3;
const WEEKLY_COUNT = 2;

// Deterministic, seed-stable selection. Hashing (seed, template id) and sorting
// gives the same shared set for everyone on a given day or week, with a stable
// id tiebreak so the order never wobbles.
function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pick(pool: QuestTemplate[], seed: number, n: number): QuestTemplate[] {
  return [...pool]
    .map((t) => ({ t, h: strHash(`${seed}:${t.id}`) }))
    .sort((a, b) => a.h - b.h || a.t.id.localeCompare(b.t.id))
    .slice(0, n)
    .map((x) => x.t);
}

// Today's daily templates (shared by everyone), independent of any progress.
function dailyTemplates(now: Date): QuestTemplate[] {
  return pick(DAILY_POOL, dateSeed(now), DAILY_COUNT);
}

// This week's weekly templates (shared by everyone), independent of progress.
function weeklyTemplates(now: Date): QuestTemplate[] {
  return pick(WEEKLY_POOL, weekSeed(now), WEEKLY_COUNT);
}

/* ───────────────────────── local store ───────────────────────── */

const KEY = "lionade.techhub.quests.v1";

interface PeriodState {
  /** Period key: a UTC day-key for daily, the weekSeed string for weekly. */
  period: string;
  /** Snapshot captured when this period began, used for delta objectives. */
  baseline: Snap;
}

interface Store {
  daily?: PeriodState;
  weekly?: PeriodState;
  /** Earned cosmetic badge ids (cumulative, never lost across periods). */
  badges: string[];
}

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function read(): Store {
  if (typeof window === "undefined") return { badges: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { badges: [] };
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return { badges: [] };
    return { daily: p.daily, weekly: p.weekly, badges: Array.isArray(p.badges) ? p.badges : [] };
  } catch {
    return { badges: [] };
  }
}

function save(s: Store): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function periodState(prev: PeriodState | undefined, period: string, snap: Snap): { state: PeriodState; changed: boolean } {
  if (prev && prev.period === period && prev.baseline) return { state: prev, changed: false };
  // New period (or first ever): the baseline is the current snapshot, so every
  // delta objective starts at zero for this period.
  return { state: { period, baseline: snap }, changed: true };
}

// The baseline to measure deltas against, WITHOUT persisting anything. Used by
// the pure read (getQuests). For a brand new period the baseline is the current
// snapshot, exactly the value syncQuests will persist, so the read stays correct
// even before the side effect has run.
function resolveBaseline(prev: PeriodState | undefined, period: string, snap: Snap): Snap {
  if (prev && prev.period === period && prev.baseline) return prev.baseline;
  return snap;
}

/* ───────────────────────── evaluation ───────────────────────── */

export interface QuestView {
  id: string;
  tier: QuestTier;
  title: string;
  desc: string;
  target: number;
  /** Clamped to the target. */
  progress: number;
  done: boolean;
  badge: QuestBadge;
}

export interface QuestsState {
  daily: QuestView[];
  weekly: QuestView[];
}

function evaluate(template: QuestTemplate, current: Snap, baseline: Snap): QuestView {
  const cur = template.read(current);
  const raw = template.relative ? cur - template.read(baseline) : cur;
  const progress = Math.max(0, Math.min(template.target, raw));
  const badge = getQuestBadge(template.badgeId) ?? QUEST_BADGES[0];
  return { id: template.id, tier: template.tier, title: template.title, desc: template.desc, target: template.target, progress, done: progress >= template.target, badge };
}

/**
 * The current quests with personal progress. PURE READ: this computes the view
 * from localStorage and the stat snapshot but never writes. Call after mount (it
 * reads localStorage); before mount the UI renders skeleton rows to avoid a flash
 * of zero. Pair with syncQuests() (run once from a mount effect) to persist the
 * period baselines and grant any cleared cosmetic badge.
 */
export function getQuests(now: Date = new Date()): QuestsState {
  // SSR / pre-mount: read() returns an empty store and currentSnap() an empty
  // snapshot, so the baseline equals the snapshot and nothing reads as falsely
  // complete.
  const snap = currentSnap();
  const store = read();
  const dailyBase = resolveBaseline(store.daily, dayString(now), snap);
  const weeklyBase = resolveBaseline(store.weekly, String(weekSeed(now)), snap);
  return {
    daily: dailyTemplates(now).map((t) => evaluate(t, snap, dailyBase)),
    weekly: weeklyTemplates(now).map((t) => evaluate(t, snap, weeklyBase)),
  };
}

/**
 * Persist the period baselines and grant the cosmetic badge for any quest cleared
 * this period. This is the side-effecting half of getQuests, kept out of the
 * render phase: call it once from a mount effect (and on the focus refresh), not
 * from a useMemo. Idempotent and client-only. Cosmetic only: never touches Fangs
 * or XP.
 */
export function syncQuests(now: Date = new Date()): void {
  if (typeof window === "undefined") return;
  const snap = currentSnap();
  const store = read();
  let changed = false;

  const d = periodState(store.daily, dayString(now), snap);
  const w = periodState(store.weekly, String(weekSeed(now)), snap);
  if (d.changed) { store.daily = d.state; changed = true; }
  if (w.changed) { store.weekly = w.state; changed = true; }

  const daily = dailyTemplates(now).map((t) => evaluate(t, snap, d.state.baseline));
  const weekly = weeklyTemplates(now).map((t) => evaluate(t, snap, w.state.baseline));

  // Grant the cosmetic badge for any cleared quest. Idempotent: a badge already
  // in the set is left alone, so re-clearing the same template later is a no-op.
  const earned = new Set(store.badges);
  for (const q of [...daily, ...weekly]) {
    if (q.done && !earned.has(q.badge.id)) {
      earned.add(q.badge.id);
      changed = true;
    }
  }
  if (changed) {
    store.badges = [...earned];
    save(store);
  }
}

/** The cosmetic badge ids the player has earned (cumulative). */
export function getEarnedQuestBadgeIds(): string[] {
  return read().badges;
}

/** Earned badges resolved to their definitions, in registry order. */
export function getEarnedQuestBadges(): QuestBadge[] {
  const earned = new Set(read().badges);
  return QUEST_BADGES.filter((b) => earned.has(b.id));
}
