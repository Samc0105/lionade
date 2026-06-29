// End-of-shift manager debrief. Each career track has a standing boss who reads
// your shift back to you in their own voice, reacting to the grade, SLA
// breaches, and anything you mishandled. Fully deterministic (seeded off the
// shift id) and zero-API, so the same run always gets the same note while
// different shifts in the same tier read differently.

import { getStats, getCareerLevel } from "./stats";
import { chapterForLevel, nextPromotion } from "./saga";
import { getConceptMastery, getWeakestConcepts, conceptLabel } from "./conceptMastery";

export interface Manager { name: string; role: string; initial: string; accent: string }
export interface ManagerReview extends Manager { verdict: string; tone: "great" | "good" | "ok" | "poor" }

const MANAGERS: Record<string, Manager> = {
  helpdesk: { name: "Dana Whitfield", role: "Support Lead", initial: "D", accent: "#4A90D9" },
  soc: { name: "Marcus Reyes", role: "SOC Manager", initial: "M", accent: "#2BBE6B" },
  swe: { name: "Priya Nair", role: "Engineering Manager", initial: "P", accent: "#A855F7" },
  redteam: { name: "Vic Calloway", role: "Engagement Lead", initial: "V", accent: "#EF4444" },
};
const FALLBACK: Manager = { name: "Shift Supervisor", role: "Operations", initial: "S", accent: "#94A3B8" };

// Voice differs by tier. Pick one opener deterministically per shift so a given
// run always reads the same, but neighbouring shifts vary.
const OPENERS: Record<ManagerReview["tone"], string[]> = {
  great: [
    "That is exactly the shift I want to see.",
    "Textbook. The whole floor should run a shift like that.",
    "Nothing slipped, nothing burned. Clean work.",
  ],
  good: [
    "Solid shift. You handled the queue and kept people calm.",
    "Good work out there. A couple of rough edges, nothing serious.",
    "I can leave you on the desk without watching. That counts for a lot.",
  ],
  ok: [
    "You got through it, but it was closer than it needed to be.",
    "Passable. We kept the lights on, just not gracefully.",
    "It worked out, though I want tighter calls next time.",
  ],
  poor: [
    "We need to talk about this one.",
    "That shift cost us. Let us reset before the next one.",
    "Rough night. I have seen worse, but not by much.",
  ],
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export interface ReviewInput {
  track: string;
  shiftId: string;
  grade: string;
  resolved: number;
  total: number;
  breaches: number;
  fumbles: number;
}

export function managerReviewFor(o: ReviewInput): ManagerReview {
  const mgr = MANAGERS[o.track] ?? FALLBACK;
  const passing = !["D", "F"].includes(o.grade);
  const tone: ManagerReview["tone"] = !passing
    ? "poor"
    : (o.grade === "S" || o.grade === "A") && o.breaches === 0 && o.fumbles === 0
      ? "great"
      : o.fumbles <= 1 && o.breaches <= 1 && (o.grade === "A" || o.grade === "B")
        ? "good"
        : "ok";

  const openers = OPENERS[tone];
  const opener = openers[hash(o.shiftId) % openers.length];

  // Specific clauses layered on top of the tier opener.
  const clauses: string[] = [];
  if (o.total > 0 && o.resolved === o.total && o.fumbles === 0) {
    clauses.push("Every ticket closed clean.");
  } else if (o.resolved < o.total) {
    const left = o.total - o.resolved;
    clauses.push(`${left} ticket${left === 1 ? "" : "s"} we never got to.`);
  }
  if (o.fumbles > 0) {
    clauses.push(`${o.fumbles} call${o.fumbles === 1 ? "" : "s"} went the wrong way. Walk me through your thinking on those.`);
  }
  if (o.breaches > 0) {
    clauses.push(`${o.breaches} SLA breach${o.breaches === 1 ? "" : "es"}. Hit the high-priority queue first next time.`);
  }
  if (tone === "great") {
    clauses.push("Keep this up and we are talking about your next title.");
  }

  return { ...mgr, tone, verdict: [opener, ...clauses].join(" ") };
}

/* ───────────────────── Manager 1:1 review cadence ────────────────────── */
// Periodic 1:1 performance reviews. Every ONE_ON_ONE_EVERY cleared shifts the
// player sits a 1:1 with their manager: a short line tied to their current saga
// chapter, one or two concrete goals pulled from their weakest concepts, and a
// review of how the goals set at the previous 1:1 turned out. Fully deterministic
// off the cleared shift count and the local mastery store, client only, and
// purely cosmetic. It grants no Fangs and never reads or writes the economy.

/** How many cleared shifts pass between one 1:1 and the next. */
export const ONE_ON_ONE_EVERY = 5;

const ONE_ON_ONE_KEY = "lionade.techhub.oneonone.v1";

// A recurring mentor figure delivers every 1:1. Gold accent ties them to the
// career ladder and saga theme (the promotion moment is gold too).
const MENTOR: Manager = { name: "Jordan Avery", role: "Your Manager", initial: "J", accent: "#FFD700" };

// Opener pool. Each references the player's current chapter title so the 1:1
// reads as a beat in the saga, not a generic form. Picked deterministically off
// the session number so a given 1:1 always reads the same. No long dashes here.
const ONE_ON_ONE_OPENERS: ((title: string) => string)[] = [
  (t) => `Let us take stock. You are holding the ${t} seat well, and the floor has noticed.`,
  (t) => `Good to sit down properly. As ${t}, the bar moves up, so let us talk about what is next.`,
  (t) => `Quick check in. The work you are doing as ${t} is landing. Now let us sharpen the edges.`,
  (t) => `I like where you are headed. ${t} suits you, and there is plenty of room to grow into it.`,
];

/** A goal carried between 1:1s, with the mastery snapshot from when it was set. */
export interface OneOnOneGoal {
  /** Concept id the goal targets (from the concept taxonomy). */
  concept: string;
  /** Display label for the concept. */
  label: string;
  /** Mastery percentage when the goal was set, or null if untracked then. */
  startPct: number | null;
  /** Mastery percentage the player is asked to reach. */
  targetPct: number;
}

/** How a goal from the previous 1:1 turned out, snapshotted at the next 1:1. */
export interface PriorGoalReview {
  concept: string;
  label: string;
  startPct: number | null;
  /** Mastery percentage at the moment the review was taken. */
  endPct: number | null;
  targetPct: number;
  achieved: boolean;
  /** Change in mastery points since the goal was set (0 when either end is untracked). */
  delta: number;
}

/** An active goal with live progress layered on top of its snapshot. */
export interface OneOnOneGoalView extends OneOnOneGoal {
  /** Current mastery percentage, read live, or null when untracked. */
  currentPct: number | null;
  achieved: boolean;
  delta: number;
}

/** The full 1:1 to render: manager, line, goals, and the prior review. */
export interface OneOnOneSession {
  /** 1-based session number (your first 1:1 is 1). */
  index: number;
  manager: Manager;
  /** Opening line, tied to the current chapter. */
  headline: string;
  /** Closing line, teasing the next promotion. */
  signoff: string;
  chapterTitle: string;
  chapterLevel: number;
  /** The responsibility the current chapter unlocks (saga flavor). */
  unlocked: string;
  goals: OneOnOneGoalView[];
  prior: PriorGoalReview[];
}

/** Everything the review surface needs, including the locked / not-yet state. */
export interface OneOnOneStatus {
  /** Whether at least one 1:1 has come due (cleared shifts reached the cadence). */
  unlocked: boolean;
  cadence: number;
  shiftsCleared: number;
  /** Number of 1:1s held so far. */
  sessionsHeld: number;
  /** Cleared-shift count that triggers the next 1:1. */
  nextAtShift: number;
  shiftsUntilNext: number;
  /** The latest 1:1 to display, or null while still locked. */
  session: OneOnOneSession | null;
}

interface OneOnOneStore {
  /** Session number whose goals are active (0 means none set yet). */
  index: number;
  goals: OneOnOneGoal[];
  prior: PriorGoalReview[];
}

function emptyStore(): OneOnOneStore {
  return { index: 0, goals: [], prior: [] };
}

function readStore(): OneOnOneStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(ONE_ON_ONE_KEY);
    if (!raw) return emptyStore();
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return emptyStore();
    return {
      index: typeof p.index === "number" ? p.index : 0,
      goals: Array.isArray(p.goals) ? (p.goals as OneOnOneGoal[]) : [],
      prior: Array.isArray(p.prior) ? (p.prior as PriorGoalReview[]) : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(s: OneOnOneStore): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(ONE_ON_ONE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// Where to set the bar for a concept: lift a weak spot into the next band, then
// keep nudging. weak (under 50) aims for a comfortable 60, the middle band aims
// for a solid 85, and an already strong concept aims a little higher still.
function goalTargetFor(startPct: number | null): number {
  const base = startPct ?? 0;
  if (base < 50) return 60;
  if (base < 80) return 85;
  return Math.min(100, Math.max(base + 10, 90));
}

// Pull one or two fresh goals from the player's current weakest concepts. When no
// mastery has been recorded yet this returns [] and the surface shows a prompt to
// play more first.
function pickActiveGoals(): OneOnOneGoal[] {
  const rows = getConceptMastery();
  const byId = new Map(rows.map((r) => [r.concept, r] as const));
  return getWeakestConcepts(2).slice(0, 2).map((id) => {
    const startPct = byId.get(id)?.pct ?? null;
    return { concept: id, label: conceptLabel(id), startPct, targetPct: goalTargetFor(startPct) };
  });
}

// Grade a set of prior goals against current mastery, for the "since last time"
// review shown when a new 1:1 comes due.
function reviewGoals(goals: OneOnOneGoal[]): PriorGoalReview[] {
  const rows = getConceptMastery();
  const byId = new Map(rows.map((r) => [r.concept, r] as const));
  return goals.map((g) => {
    const endPct = byId.get(g.concept)?.pct ?? null;
    const achieved = endPct !== null && endPct >= g.targetPct;
    const delta = endPct !== null && g.startPct !== null ? endPct - g.startPct : 0;
    return { concept: g.concept, label: g.label, startPct: g.startPct, endPct, targetPct: g.targetPct, achieved, delta };
  });
}

/**
 * Advance the 1:1 cadence if a new review is due. A review comes due each time the
 * cleared shift count crosses another multiple of ONE_ON_ONE_EVERY. On advance it
 * snapshots how the previous goals turned out (as `prior`), then pulls one or two
 * fresh goals from the player's current weakest concepts. Idempotent: calling it
 * again at the same milestone is a no op. Client only, writes localStorage, and
 * grants nothing. Call it once after mount, before reading the status.
 *
 * First-session clamp: a player who clears many shifts before ever opening this
 * page would otherwise land straight on a high session number with an empty prior
 * review (there is nothing to look back on yet). Their first actual sit-down is
 * always 1:1 no. 1, so the very first session is pinned to 1. Every session after
 * that tracks the true milestone count (floor(cleared / cadence)).
 */
export function advanceOneOnOneIfDue(): void {
  if (typeof window === "undefined") return;
  const cleared = getStats().shiftsCleared;
  const dueIndex = Math.floor(cleared / ONE_ON_ONE_EVERY);
  if (dueIndex < 1) return;
  const store = readStore();
  if (store.index >= dueIndex) return;
  const prior = reviewGoals(store.goals);
  const goals = pickActiveGoals();
  const nextIndex = store.index === 0 ? 1 : dueIndex;
  writeStore({ index: nextIndex, goals, prior });
}

/**
 * The current 1:1 view for the review surface. Reads the cadence position from the
 * cleared shift count and the active goals from storage, then layers live mastery
 * progress on top. Call advanceOneOnOneIfDue first (after mount) so a freshly due
 * review is generated before this reads it. Client only, read only, grants nothing.
 */
export function getOneOnOneStatus(): OneOnOneStatus {
  const cleared = typeof window === "undefined" ? 0 : getStats().shiftsCleared;
  const cadence = ONE_ON_ONE_EVERY;
  const sessionsHeld = Math.floor(cleared / cadence);
  const nextAtShift = (sessionsHeld + 1) * cadence;
  const shiftsUntilNext = Math.max(0, nextAtShift - cleared);

  if (sessionsHeld < 1) {
    return { unlocked: false, cadence, shiftsCleared: cleared, sessionsHeld: 0, nextAtShift, shiftsUntilNext, session: null };
  }

  const store = readStore();
  const level = getCareerLevel().level;
  const chapter = chapterForLevel(level);
  const rows = getConceptMastery();
  const byId = new Map(rows.map((r) => [r.concept, r] as const));

  const goals: OneOnOneGoalView[] = store.goals.map((g) => {
    const currentPct = byId.get(g.concept)?.pct ?? null;
    const achieved = currentPct !== null && currentPct >= g.targetPct;
    const delta = currentPct !== null && g.startPct !== null ? currentPct - g.startPct : 0;
    return { ...g, currentPct, achieved, delta };
  });

  const index = store.index || sessionsHeld;
  const opener = ONE_ON_ONE_OPENERS[hash(`oneonone:${index}`) % ONE_ON_ONE_OPENERS.length];
  const next = nextPromotion(level);
  const signoff = next
    ? `Keep closing these out and ${next.title} is well within reach.`
    : "You are at the top of the ladder now. From here, you set the standard.";

  const session: OneOnOneSession = {
    index,
    manager: MENTOR,
    headline: opener(chapter.title),
    signoff,
    chapterTitle: chapter.title,
    chapterLevel: chapter.level,
    unlocked: chapter.unlocked,
    goals,
    prior: store.prior,
  };

  return { unlocked: true, cadence, shiftsCleared: cleared, sessionsHeld, nextAtShift, shiftsUntilNext, session };
}
