// The combination engine. Assembles a fresh Shift from the ticket POOL plus a
// roll of modifiers (mutators), so every session is a different combination. A
// seeded variant gives a stable "Daily Combo" everyone shares; the unseeded
// variant is a "Surprise Shift" that re-rolls every time.

import type { Shift, ShiftItem, ShiftModifier } from "./types";
import type { Track } from "@/lib/helpdesk/types";
import { POOL, MASTER_KB, MASTER_INVENTORY, MASTER_AD, INCIDENT_GROUPS, type PoolEntry } from "./pool";

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
];

/** Deterministic seed for "today" so a Daily Combo is the same for everyone. */
export function dateSeed(d: Date = new Date()): number {
  const key = d.toISOString().slice(0, 10);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h || 1;
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

  let count = opts.count ?? 6;
  if (has("overload")) count += 2;

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
  for (const p of shuffled) {
    if (picked.length >= count) break;
    if (!picked.includes(p)) picked.push(p);
  }
  const chosen = picked.slice(0, count);

  const items: ShiftItem[] = chosen.map((p, i) => {
    const arriveAfter = i < 3 ? 0 : (i - 2) * 18;
    let it: ShiftItem = { ...p.item, arriveAfter };
    if (has("vip") && rnd() < 0.5) it = { ...it, from: { ...it.from, vip: true } };
    return it;
  });

  // Doubles: drop a full incident storm (root + duplicates) into the queue.
  if (has("doubles") && INCIDENT_GROUPS.length > 0) {
    const g = INCIDENT_GROUPS[Math.floor(rnd() * INCIDENT_GROUPS.length)];
    g.items.forEach((it, k) => items.push({ ...it, arriveAfter: 30 + k * 6 }));
  }

  const slaScales: number[] = [];
  if (has("rush")) slaScales.push(0.6);
  if (has("graveyard")) slaScales.push(0.75);
  const penScales: number[] = [];
  if (has("audit")) penScales.push(2);
  if (has("graveyard")) penScales.push(1.5);

  return {
    id: `surprise-${seed}`,
    track: opts.track ?? "helpdesk",
    order: -1,
    name: opts.name ?? "Surprise Shift",
    rank: "Mixed Queue",
    accent: has("graveyard") ? "#6E8BC0" : "#A855F7",
    durationSeconds: 600,
    startingBudget: has("budget") ? 0 : 3000,
    inventory: has("budget") ? [] : MASTER_INVENTORY,
    kb: MASTER_KB,
    adUsers: MASTER_AD,
    items,
    slaScale: slaScales.length ? Math.min(...slaScales) : undefined,
    noHints: has("skeleton") ? true : undefined,
    penaltyScale: penScales.length ? Math.max(...penScales) : undefined,
    graveyard: has("graveyard") ? true : undefined,
    modifiers: mods.map((id) => MODIFIERS.find((m) => m.id === id)).filter(Boolean) as ShiftModifier[],
  };
}
