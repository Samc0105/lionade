// Daily completion log for TechHub's three shared, deterministic modes (Daily
// Combo, Daily Chaos, Weekly Challenge). Local only: a personal "did I clock in
// today" tracker, NOT the economy. The economy stays server-authoritative, so
// nothing here grants Fangs. Recorded from the play screen on a passing shift.
//
// Keyed by calendar day using the SAME UTC day-key as lib/liondesk/playstreak.ts
// (toISOString().slice(0, 10)) so the clock-in calendar and the play streak can
// never disagree about which day "today" is.

export type DailyMode = "combo" | "chaos" | "weekly";

export interface DailyModeMeta { id: DailyMode; label: string }

/** The three deterministic shared modes, in display order. */
export const DAILY_MODES: DailyModeMeta[] = [
  { id: "combo", label: "Daily Combo" },
  { id: "chaos", label: "Daily Chaos" },
  { id: "weekly", label: "Weekly Challenge" },
];

// Per-day record: mode id -> best grade cleared that day ("S".."C").
type DayLog = Partial<Record<DailyMode, string>>;
type LogStore = Record<string, DayLog>;

const KEY = "lionade.techhub.dailylog.v1";
// Trim anything older than this so the store cannot grow without bound.
const KEEP_DAYS = 60;

// Higher is better. Used to keep the best grade seen for a mode on a given day.
const GRADE_RANK: Record<string, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };

// ── UTC day-key helpers (identical approach to playstreak.ts) ──
function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function prevDay(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return dayString(d);
}
function dayBefore(today: string, back: number): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - back);
  return dayString(d);
}

function betterGrade(a: string, b: string): string {
  return (GRADE_RANK[a] ?? -1) >= (GRADE_RANK[b] ?? -1) ? a : b;
}

function read(): LogStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? (p as LogStore) : {};
  } catch {
    return {};
  }
}
function save(s: LogStore): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function dayLogOf(store: LogStore, key: string): DayLog {
  const v = store[key];
  return v && typeof v === "object" ? v : {};
}

function prune(store: LogStore, today: string): void {
  const cutoff = dayBefore(today, KEEP_DAYS); // ISO keys sort lexicographically
  for (const k of Object.keys(store)) if (k < cutoff) delete store[k];
}

/**
 * Record that one of the three shared modes was cleared today, keeping the best
 * grade seen for that mode on this calendar day. Display only: grants nothing.
 */
export function recordDailyClear(mode: DailyMode, grade: string): void {
  if (typeof window === "undefined") return;
  const store = read();
  const today = dayString(new Date());
  const day: DayLog = { ...dayLogOf(store, today) };
  const prev = day[mode];
  day[mode] = prev ? betterGrade(prev, grade) : grade;
  store[today] = day;
  prune(store, today);
  save(store);
}

export interface TodayStatus {
  mode: DailyMode;
  label: string;
  cleared: boolean;
  /** Best grade cleared today, or null if not yet cleared. */
  grade: string | null;
}

/** Which of the three shared modes are cleared today, with the best grade each. */
export function getTodayStatus(): TodayStatus[] {
  const store = read();
  const log = dayLogOf(store, dayString(new Date()));
  return DAILY_MODES.map((m) => ({
    mode: m.id,
    label: m.label,
    cleared: !!log[m.id],
    grade: log[m.id] ?? null,
  }));
}

export interface CalendarCell {
  /** UTC day-key, YYYY-MM-DD. */
  day: string;
  /** How many of the three shared modes were cleared that day (0 to 3). */
  cleared: number;
  /** Which modes were cleared that day. */
  modes: DailyMode[];
  isToday: boolean;
}

/**
 * The last `days` calendar days (default 14), oldest first, for a clock-in grid.
 * Built by walking back from today's UTC key so it matches the recorded keys and
 * the play streak exactly.
 */
export function getRecentDays(days = 14): CalendarCell[] {
  const store = read();
  const today = dayString(new Date());
  const out: CalendarCell[] = [];
  let cursor = today;
  for (let i = 0; i < days; i++) {
    const log = dayLogOf(store, cursor);
    const modes = DAILY_MODES.map((m) => m.id).filter((id) => !!log[id]);
    out.push({ day: cursor, cleared: modes.length, modes, isToday: cursor === today });
    cursor = prevDay(cursor);
  }
  return out.reverse(); // oldest first for a left-to-right grid
}
