// Daily play streak for TechHub. Counts consecutive calendar days on which you
// completed at least one shift. Local only (a personal habit nudge, not the
// economy). Recorded from the play screens on shift completion.

export interface PlayStreak { current: number; best: number; lastDay: string }

const KEY = "lionade.techhub.playstreak.v1";

// Consecutive-day streak lengths that fire a one-time celebration moment and
// gate the streak desk themes. A loss-aversion retention hook: purely cosmetic
// progression, never any Fangs.
export const STREAK_MILESTONES = [3, 7, 14, 30] as const;

// A milestone awaiting its celebration moment is stashed here by recordPlayDay
// and consumed once by AchievementBanner.
const PENDING_KEY = "lionade.techhub.playstreak.pending.v1";

/** Banner id for a streak milestone, reusing the AchievementBanner id pattern. */
export function streakBannerId(milestone: number): string {
  return `streak:${milestone}`;
}

/**
 * The milestone newly reached when the streak grows from `prev` to `next` days,
 * or null when no threshold was crossed. The streak only ever grows by one day
 * at a time, so at most one milestone is crossed per play.
 */
export function crossedMilestone(prev: number, next: number): number | null {
  for (const m of STREAK_MILESTONES) {
    if (next >= m && prev < m) return m;
  }
  return null;
}

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function prevDay(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return dayString(d);
}

function read(): PlayStreak {
  if (typeof window === "undefined") return { current: 0, best: 0, lastDay: "" };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { current: 0, best: 0, lastDay: "" };
    const p = JSON.parse(raw);
    return { current: p.current ?? 0, best: p.best ?? 0, lastDay: p.lastDay ?? "" };
  } catch {
    return { current: 0, best: 0, lastDay: "" };
  }
}

function save(s: PlayStreak): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function setPendingMilestone(m: number): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PENDING_KEY, String(m)); } catch { /* ignore */ }
}

/**
 * Read and clear the milestone awaiting its celebration moment. Consume-once, so
 * the banner fires exactly one time after the play that crossed the threshold.
 */
export function takePendingStreakMilestone(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(PENDING_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Current streak, decayed to 0 if more than a day has lapsed since you played. */
export function getPlayStreak(): PlayStreak {
  const s = read();
  if (!s.lastDay) return s;
  const today = dayString(new Date());
  if (s.lastDay === today || s.lastDay === prevDay(today)) return s;
  return { ...s, current: 0 };
}

/**
 * Call when a shift completes. Extends or resets the streak for today, and when
 * this play crosses a milestone, stashes it so a moment fires once (see
 * takePendingStreakMilestone). Return shape is unchanged for existing callers.
 */
export function recordPlayDay(): PlayStreak {
  const s = read();
  const today = dayString(new Date());
  if (s.lastDay === today) return s; // already counted today
  const contiguous = s.lastDay === prevDay(today);
  const prevCurrent = contiguous ? s.current : 0;
  const next: PlayStreak = {
    current: contiguous ? s.current + 1 : 1,
    best: s.best,
    lastDay: today,
  };
  next.best = Math.max(next.best, next.current);
  save(next);
  const milestone = crossedMilestone(prevCurrent, next.current);
  if (milestone) setPendingMilestone(milestone);
  return next;
}
