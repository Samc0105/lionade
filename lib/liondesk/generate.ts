// The combination engine. Assembles a fresh Shift from the ticket POOL plus a
// roll of modifiers (mutators), so every session is a different combination. A
// seeded variant gives a stable "Daily Combo" everyone shares; the unseeded
// variant is a "Surprise Shift" that re-rolls every time.

import type { Shift, ShiftItem, ShiftModifier } from "./types";
import type { Track } from "@/lib/helpdesk/types";
import { POOL, MASTER_KB, MASTER_INVENTORY, MASTER_AD, INCIDENT_GROUPS, type PoolEntry } from "./pool";
import { getReputation, departmentOf } from "./reputation";
import { conceptForItem } from "./concepts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Flatten chain tickets: the trigger keeps everything but its chain fields, and
// each follow-up becomes a hidden item revealed when the trigger resolves/fails.
function expandChains(items: ShiftItem[]): ShiftItem[] {
  const out: ShiftItem[] = [];
  for (const it of items) {
    const { chainOnResolve, chainOnFail, ...base } = it;
    out.push(base as ShiftItem);
    if (chainOnResolve) out.push({ ...chainOnResolve, arriveAfter: 0, revealedBy: { itemId: it.id, on: "resolve" } });
    if (chainOnFail) out.push({ ...chainOnFail, arriveAfter: 0, revealedBy: { itemId: it.id, on: "fail" } });
  }
  return out;
}

export const MODIFIERS: ShiftModifier[] = [
  { id: "rush", label: "Rush Hour", desc: "Tighter SLAs across the board. The clock is mean." },
  { id: "vip", label: "VIP Day", desc: "Half the queue is VIPs, and they remember a botched call." },
  { id: "skeleton", label: "Skeleton Crew", desc: "No hints. You're on your own tonight." },
  { id: "overload", label: "Overload", desc: "Two extra tickets jammed into the queue." },
  { id: "budget", label: "Budget Freeze", desc: "Stockroom closed. No part orders allowed." },
  { id: "phishwave", label: "Phishing Wave", desc: "Extra phishing landing in the inbox." },
  { id: "audit", label: "Audit", desc: "A reviewer is watching. Wrong moves cost double." },
  { id: "graveyard", label: "Graveyard", desc: "Lights down, clock tight. The night-desk vibe." },
  { id: "doubles", label: "Doubles", desc: "An incident storm hits mid-shift. Find the root." },
  { id: "callerstorm", label: "Caller Storm", desc: "The switchboard lights up. Phone calls flood the queue and the clock runs short." },
  { id: "chainreaction", label: "Chain Reaction", desc: "Every fix spawns the next. Chained tickets and incident groups cascade across the shift." },
  { id: "codered", label: "Code Red", desc: "A time compressed crisis. More tickets land, the clock runs shorter, and the SLA bites." },
];

/** Deterministic seed for "today" so a Daily Combo is the same for everyone. */
export function dateSeed(d: Date = new Date()): number {
  const key = d.toISOString().slice(0, 10);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h || 1;
}

/** Deterministic seed for "this week" so the Weekly Challenge is shared. */
export function weekSeed(d: Date = new Date()): number {
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
  return ((d.getFullYear() * 53 + week) >>> 0) || 1;
}

function rollModifiers(rnd: () => number): string[] {
  const ids = shuffle(MODIFIERS.map((m) => m.id), rnd);
  return ids.slice(0, rnd() < 0.5 ? 1 : 2);
}

export interface GenerateOpts {
  seed?: number;
  track?: Track;
  count?: number;
  modifierIds?: string[];
  /** Roll 3-4 modifiers instead of 1-2. */
  chaos?: boolean;
  name?: string;
}

export function generateShift(opts: GenerateOpts = {}): Shift {
  const seed = (opts.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
  const rnd = mulberry32(seed);
  const mods = opts.modifierIds
    ?? (opts.chaos ? shuffle(MODIFIERS.map((m) => m.id), rnd).slice(0, 3 + Math.floor(rnd() * 2)) : rollModifiers(rnd));
  const has = (id: string) => mods.includes(id);
  // Reputation bites only in non-seeded (personal) shifts, so seeded Daily/Weekly
  // stay identical for everyone. A neglected department arrives impatient (VIP).
  const rep = opts.seed == null ? getReputation() : null;

  let count = opts.count ?? 6;
  if (has("overload")) count += 2;
  // Code Red is a time compressed crisis: more tickets land and the clock is
  // shorter (see durationSeconds below) on top of the strictest SLA.
  if (has("codered")) count += 3;

  let pool: PoolEntry[] = POOL.filter((p) => !opts.track || p.track === opts.track);
  if (has("budget")) pool = pool.filter((p) => !p.item.part);
  const shuffled = shuffle(pool, rnd);

  const picked: PoolEntry[] = [];
  if (has("phishwave")) {
    for (const p of shuffled) {
      if (picked.length >= 2) break;
      if (p.item.email?.isPhish) picked.push(p);
    }
  }
  // Caller Storm: the switchboard lights up. Pull phone calls to the front of the
  // draw so most of the queue is live calls, paired with a tighter SLA window
  // below so a phone heavy board really does play like a switchboard under pressure.
  if (has("callerstorm")) {
    const phoneTarget = Math.max(1, Math.ceil(count * 0.7));
    for (const p of shuffled) {
      if (picked.length >= phoneTarget) break;
      if (p.item.channel === "phone" && !picked.includes(p)) picked.push(p);
    }
  }
  // Chain Reaction: pull tickets that spawn a follow-up to the front, so resolving
  // one thing reveals the next. Incident groups are also forced in below, so one
  // root cause keeps cascading into more work.
  if (has("chainreaction")) {
    const chainTarget = Math.max(1, Math.ceil(count * 0.6));
    for (const p of shuffled) {
      if (picked.length >= chainTarget) break;
      if ((p.item.chainOnResolve || p.item.chainOnFail) && !picked.includes(p)) picked.push(p);
    }
  }
  for (const p of shuffled) {
    if (picked.length >= count) break;
    if (!picked.includes(p)) picked.push(p);
  }
  const chosen = picked.slice(0, count);

  const items: ShiftItem[] = chosen.map((p, i) => {
    const arriveAfter = i < 3 ? 0 : (i - 2) * 18;
    let it: ShiftItem = { ...p.item, arriveAfter };
    if (has("vip") && rnd() < 0.5) it = { ...it, from: { ...it.from, vip: true } };
    if (rep && (rep[departmentOf(it.from.role)] ?? 50) < 40 && rnd() < 0.6) it = { ...it, from: { ...it.from, vip: true } };
    return it;
  });

  // Doubles / Chain Reaction: drop a full incident storm (root + duplicates) into
  // the queue so one root cause cascades into a flood of related tickets.
  if ((has("doubles") || has("chainreaction")) && INCIDENT_GROUPS.length > 0) {
    const g = INCIDENT_GROUPS[Math.floor(rnd() * INCIDENT_GROUPS.length)];
    g.items.forEach((it, k) => items.push({ ...it, arriveAfter: 30 + k * 6 }));
  }

  const slaScales: number[] = [];
  if (has("rush")) slaScales.push(0.6);
  if (has("graveyard")) slaScales.push(0.75);
  // Caller Storm tightens the window so callers breach sooner; Code Red is the
  // strictest clock of all. Math.min below keeps the tightest active scale.
  if (has("callerstorm")) slaScales.push(0.7);
  if (has("codered")) slaScales.push(0.5);
  const penScales: number[] = [];
  if (has("audit")) penScales.push(2);
  if (has("graveyard")) penScales.push(1.5);

  const expanded = expandChains(items);

  return {
    id: `surprise-${seed}`,
    track: opts.track ?? "helpdesk",
    order: -1,
    name: opts.name ?? "Surprise Shift",
    rank: "Mixed Queue",
    accent: has("codered") ? "#EF4444" : has("graveyard") ? "#6E8BC0" : "#A855F7",
    durationSeconds: has("codered") ? 450 : 600,
    startingBudget: has("budget") ? 0 : 3000,
    inventory: has("budget") ? [] : MASTER_INVENTORY,
    kb: MASTER_KB,
    adUsers: MASTER_AD,
    items: expanded,
    slaScale: slaScales.length ? Math.min(...slaScales) : undefined,
    noHints: has("skeleton") ? true : undefined,
    penaltyScale: penScales.length ? Math.max(...penScales) : undefined,
    graveyard: has("graveyard") ? true : undefined,
    modifiers: mods.map((id) => MODIFIERS.find((m) => m.id === id)).filter(Boolean) as ShiftModifier[],
  };
}

export interface WeakSpotsOpts {
  /** Concept ids to bias toward, weakest first. Empty means a varied review. */
  weakConcepts?: string[];
  seed?: number;
  track?: Track;
  count?: number;
  name?: string;
}

/**
 * Build a focused "Weak Spots" shift biased toward the concepts the player
 * handles worst (see lib/liondesk/conceptMastery.ts for the source of the
 * weakest list). Reuses the shared ticket POOL and the same item assembly plus
 * chain expansion as generateShift, but skips the random mutator roll so the
 * review stays calm and on topic. No economy: the Fangs and XP a shift previews
 * are still granted server side only, never from the client.
 */
export function generateWeakSpotsShift(opts: WeakSpotsOpts = {}): Shift {
  const seed = (opts.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
  const rnd = mulberry32(seed);
  const count = opts.count ?? 6;
  const weak = new Set(opts.weakConcepts ?? []);

  const pool: PoolEntry[] = POOL.filter((p) => !opts.track || p.track === opts.track);
  const shuffled = shuffle(pool, rnd);

  // Partition once into tickets that exercise a weak concept and the rest.
  const onWeak: PoolEntry[] = [];
  const rest: PoolEntry[] = [];
  for (const p of shuffled) (weak.has(conceptForItem(p.item)) ? onWeak : rest).push(p);

  // Aim about 70% of the board at weak concepts, then top up from the rest so
  // the queue is always full even when weak-concept tickets are scarce.
  const target = weak.size ? Math.max(1, Math.ceil(count * 0.7)) : 0;
  const picked: PoolEntry[] = [];
  for (const p of onWeak) { if (picked.length >= target) break; picked.push(p); }
  for (const p of rest) { if (picked.length >= count) break; picked.push(p); }
  for (const p of onWeak) { if (picked.length >= count) break; if (!picked.includes(p)) picked.push(p); }
  const chosen = picked.slice(0, count);

  const items: ShiftItem[] = chosen.map((p, i) => ({ ...p.item, arriveAfter: i < 3 ? 0 : (i - 2) * 18 }));
  const expanded = expandChains(items);

  return {
    id: `weakspots-${seed}`,
    track: opts.track ?? "helpdesk",
    order: -1,
    name: opts.name ?? "Weak Spots",
    rank: "Targeted Review",
    accent: "#A855F7",
    durationSeconds: 600,
    startingBudget: 3000,
    inventory: MASTER_INVENTORY,
    kb: MASTER_KB,
    adUsers: MASTER_AD,
    items: expanded,
    modifiers: [],
  };
}

// Adaptive difficulty (Idea 28). Letter grades map to points so a run of recent
// grades averages into one number: S is the top, D the floor (see the grade
// ladder in lib/liondesk/scoring.ts). The adaptive generator reads this average
// to decide whether to step the next shift up, hold it, or ease it.
const GRADE_POINTS: Record<string, number> = { S: 4, A: 3, B: 2, C: 1, D: 0 };

export interface AdaptiveTuning {
  /** The chosen move: 1 stepped up, 0 held steady, -1 eased off. */
  step: -1 | 0 | 1;
  /** Ticket count after the size nudge, clamped to the lab's 4 to 9 range. */
  count: number;
  /** SLA budget multiplier (above 1 looser, below 1 tighter). Undefined is the 1.0 baseline. */
  slaScale?: number;
  /** A short, user-facing summary of the tuning. No dashes. */
  summary: string;
}

/**
 * Decide how to tune the next shift from the player's recent letter grades, to
 * hold them in productive struggle range. A run of strong clears (averaging
 * roughly a B or better) steps the shift up: one more ticket and a tighter SLA
 * clock. A run of struggles (averaging below a C) eases it: one fewer ticket and
 * a more generous clock. A mixed or empty record holds steady at the baseline.
 * Pure and deterministic with no side effects, so the UI can call it for a preview
 * and the generator can call it to build the shift, and the two never disagree.
 */
export function adaptiveTuning(recentGrades: string[] = [], baseCount = 6): AdaptiveTuning {
  const clampCount = (n: number) => Math.max(4, Math.min(9, n));
  const pts = recentGrades.map((g) => GRADE_POINTS[g]).filter((p): p is number => p != null);
  if (pts.length === 0) {
    return { step: 0, count: clampCount(baseCount), summary: "No recent grades yet, so this one starts at a steady baseline." };
  }
  const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
  if (avg >= 2.5) {
    return { step: 1, count: clampCount(baseCount + 1), slaScale: 0.85, summary: "Your recent grades are strong, so this one steps up: an extra ticket and a tighter clock." };
  }
  if (avg < 1.5) {
    return { step: -1, count: clampCount(baseCount - 1), slaScale: 1.3, summary: "Your recent grades dipped, so this one eases off: one fewer ticket and a more generous clock." };
  }
  return { step: 0, count: clampCount(baseCount), summary: "Your recent grades are holding steady, so the difficulty holds too." };
}

export interface AdaptiveOpts {
  /** Concept ids to bias toward, weakest first (from getWeakestConcepts). */
  weakConcepts?: string[];
  /** Recent letter grades, newest first (from getRecentGrades). Drives the size and SLA nudge. */
  recentGrades?: string[];
  seed?: number;
  track?: Track;
  /** Base ticket count before the adaptive nudge. Defaults to 6. */
  count?: number;
  name?: string;
}

/**
 * Build an adaptive practice shift that tunes to the player. It biases item
 * selection toward the concepts they handle worst (the same weak-concept
 * partition as generateWeakSpotsShift) AND nudges size and SLA pressure from
 * their recent grades (see adaptiveTuning) to hold them in productive struggle
 * range. Reuses the shared ticket POOL, the seeded RNG, and expandChains, and
 * skips the random mutator roll so the run stays focused. No economy: the Fangs
 * and XP a solve previews are granted server side only, never from the client.
 */
export function generateAdaptiveShift(opts: AdaptiveOpts = {}): Shift {
  const seed = (opts.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
  const rnd = mulberry32(seed);
  const tuning = adaptiveTuning(opts.recentGrades ?? [], opts.count ?? 6);
  const count = tuning.count;
  const weak = new Set(opts.weakConcepts ?? []);

  const pool: PoolEntry[] = POOL.filter((p) => !opts.track || p.track === opts.track);
  const shuffled = shuffle(pool, rnd);

  // Same weak-concept partition as generateWeakSpotsShift: aim about 70% of the
  // board at weak concepts, then top up from the rest so the queue is always full
  // even when weak-concept tickets are scarce.
  const onWeak: PoolEntry[] = [];
  const rest: PoolEntry[] = [];
  for (const p of shuffled) (weak.has(conceptForItem(p.item)) ? onWeak : rest).push(p);

  const target = weak.size ? Math.max(1, Math.ceil(count * 0.7)) : 0;
  const picked: PoolEntry[] = [];
  for (const p of onWeak) { if (picked.length >= target) break; picked.push(p); }
  for (const p of rest) { if (picked.length >= count) break; picked.push(p); }
  for (const p of onWeak) { if (picked.length >= count) break; if (!picked.includes(p)) picked.push(p); }
  const chosen = picked.slice(0, count);

  const items: ShiftItem[] = chosen.map((p, i) => ({ ...p.item, arriveAfter: i < 3 ? 0 : (i - 2) * 18 }));
  const expanded = expandChains(items);

  return {
    id: `adaptive-${seed}`,
    track: opts.track ?? "helpdesk",
    order: -1,
    name: opts.name ?? "Adaptive Shift",
    rank: "Adaptive Practice",
    accent: "#A855F7",
    durationSeconds: 600,
    startingBudget: 3000,
    inventory: MASTER_INVENTORY,
    kb: MASTER_KB,
    adUsers: MASTER_AD,
    items: expanded,
    slaScale: tuning.slaScale,
    modifiers: [],
  };
}
