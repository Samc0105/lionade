// Daily play streak for TechHub. Counts consecutive calendar days on which you
// completed at least one shift. Local only (a personal habit nudge, not the
// economy). Recorded from the play screens on shift completion.

export interface PlayStreak { current: number; best: number; lastDay: string }

const KEY = "lionade.techhub.playstreak.v1";

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

/** Current streak, decayed to 0 if more than a day has lapsed since you played. */
export function getPlayStreak(): PlayStreak {
  const s = read();
  if (!s.lastDay) return s;
  const today = dayString(new Date());
  if (s.lastDay === today || s.lastDay === prevDay(today)) return s;
  return { ...s, current: 0 };
}

/** Call when a shift completes. Extends or resets the streak for today. */
export function recordPlayDay(): PlayStreak {
  const s = read();
  const today = dayString(new Date());
  if (s.lastDay === today) return s; // already counted today
  const next: PlayStreak = {
    current: s.lastDay === prevDay(today) ? s.current + 1 : 1,
    best: s.best,
    lastDay: today,
  };
  next.best = Math.max(next.best, next.current);
  save(next);
  return next;
}
