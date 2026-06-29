// TechHub Saga: a narrative spine laid over the 11-title career ladder defined in
// stats.ts (CAREER_TITLES). Crossing a title is otherwise emotionally flat (it
// just pushes a "levelup" id into the 6s AchievementBanner), so this file gives
// each title a chapter: a short line from TechHub leadership delivered on the
// promotion, plus the new responsibility that promotion unlocks.
//
// Client only and purely cosmetic. It reads nothing from storage, grants no
// Fangs, and never touches the economy. It is consumed by the promotion moment
// overlay and the career area card (components/liondesk/PromotionMoment.tsx),
// which AchievementBanner fires once when a title is crossed.

import { CAREER_TITLES, titleForLevel, LEVELUP_BANNER_PREFIX } from "./stats";

/** One beat of the career story, keyed to a career level (1-based). */
export interface SagaChapter {
  /** Career level this chapter belongs to (matches CareerLevel.level, 1..11). */
  level: number;
  /** The title earned at this level, mirrored from stats.ts CAREER_TITLES. */
  title: string;
  /** A short line from a TechHub manager or leadership, said on the promotion. */
  managerLine: string;
  /** The new responsibility this promotion unlocks. */
  unlocked: string;
}

/** A newly crossed promotion plus the chapter that comes after it (if any). */
export interface Promotion {
  chapter: SagaChapter;
  next: SagaChapter | null;
}

// The narrative beat for each rung, in ladder order. Index i is career level
// i + 1, so this stays aligned with CAREER_TITLES one to one. Keep the copy free
// of long dashes (commas, periods, parentheses, and "to" only).
const BEATS: { managerLine: string; unlocked: string }[] = [
  {
    managerLine: "Welcome to TechHub. Your badge is on the desk and the queue is yours. Show us what you can do.",
    unlocked: "You can clock in, take tickets, and learn the floor.",
  },
  {
    managerLine: "You held the line through your first real rush. That earns you a proper title.",
    unlocked: "You own the front of the queue and triage your own tickets.",
  },
  {
    managerLine: "People started asking for you by name. We noticed.",
    unlocked: "You take the trickier escalations the desk used to pass up.",
  },
  {
    managerLine: "Time you had the keys. The systems behind the desk are part of your world now.",
    unlocked: "You manage accounts, backups, and the servers everyone relies on.",
  },
  {
    managerLine: "The pipes stayed up on your watch, even on the bad nights. That is a promotion.",
    unlocked: "You own the network, the routes, and the uptime the whole floor leans on.",
  },
  {
    managerLine: "You spotted what others walked straight past. We need eyes like that on security.",
    unlocked: "You read the alerts, hunt the threats, and lock down what matters.",
  },
  {
    managerLine: "You stopped firefighting and started preventing the fires. Senior suits you.",
    unlocked: "You design the fixes the rest of the team builds on.",
  },
  {
    managerLine: "The floor runs smoother on your shifts. Time to take the team with you.",
    unlocked: "You set the pace for the desk and answer for the whole shift.",
  },
  {
    managerLine: "You think in quarters now, not just tickets. Welcome to management.",
    unlocked: "You own the roadmap, the budget, and the people who run it.",
  },
  {
    managerLine: "All of it reports to you. The whole department trusts your call.",
    unlocked: "You steer every team, every system, and every escalation that lands.",
  },
  {
    managerLine: "There is no title above this one. TechHub runs on what you build now.",
    unlocked: "You set the vision for all of technology at TechHub.",
  },
];

/** The full saga, one chapter per career title, in ladder order. */
export const SAGA: SagaChapter[] = CAREER_TITLES.map((title, i) => ({
  level: i + 1,
  title,
  managerLine: BEATS[i]?.managerLine ?? "",
  unlocked: BEATS[i]?.unlocked ?? "",
}));

/** Total number of chapters (the length of the title ladder). */
export const SAGA_LENGTH = SAGA.length;

/**
 * The chapter for a career level. Levels past the final title (leveling on after
 * reaching CTO) clamp to the last chapter, mirroring titleForLevel in stats.ts.
 */
export function chapterForLevel(level: number): SagaChapter {
  const i = Math.min(Math.max(level, 1), SAGA_LENGTH) - 1;
  const beat = SAGA[i];
  // Defensive: keep title in lockstep with stats.ts even if BEATS ever lags.
  return { ...beat, title: titleForLevel(beat.level) };
}

/**
 * The next chapter after a given career level, or null once you are at (or past)
 * the top of the ladder. Used to tease what the player is climbing toward.
 */
export function nextPromotion(level: number): SagaChapter | null {
  return level >= 1 && level < SAGA_LENGTH ? chapterForLevel(level + 1) : null;
}

/**
 * Read a promotion out of an AchievementBanner levelup id (the
 * "levelup:<level>:<title>" form pushed by recordShiftResult in stats.ts).
 *
 * A promotion is a newly earned, distinct title, which is levels 2..11. Level 1
 * (Intern) is your starting rung, not something you get promoted into, and
 * leveling on past the top title (CTO) keeps leveling you up but grants no new
 * chapter. Both of those return null so the flat banner handles them and the
 * rich moment only fires on a real title change.
 */
export function promotionFromBannerId(id: string): Promotion | null {
  if (!id.startsWith(LEVELUP_BANNER_PREFIX)) return null;
  const level = Number(id.slice(LEVELUP_BANNER_PREFIX.length).split(":")[0]);
  if (!Number.isFinite(level) || level < 2 || level > SAGA_LENGTH) return null;
  return { chapter: chapterForLevel(level), next: nextPromotion(level) };
}
