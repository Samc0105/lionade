// The ticket POOL that the combination engine draws from: every standalone
// (non-incident) ticket across the authored shifts, plus the extra authored
// tickets from the offline workflow (pool-extra.generated.json). Master
// reference data (KB / inventory / AD) is unioned so a drawn ticket's tools
// always resolve no matter which shift it came from.

import { SHIFTS } from "./shifts";
import type { ShiftItem, KbArticle, InventoryItem, AdUser } from "./types";
import type { Track } from "@/lib/helpdesk/types";
import extraRaw from "./pool-extra.generated.json";

export interface PoolEntry { item: ShiftItem; track: Track }

function dedupBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

const REWARD_BY_DIFF: Record<string, { reward: number; xp: number }> = {
  Entry: { reward: 35, xp: 28 },
  Intermediate: { reward: 50, xp: 40 },
  Advanced: { reward: 70, xp: 56 },
  Expert: { reward: 90, xp: 72 },
};

export interface IncidentGroup { group: string; track: Track; items: ShiftItem[] }

const basePool: PoolEntry[] = [];
const kbAll: KbArticle[] = [];
const invAll: InventoryItem[] = [];
const adAll: AdUser[] = [];
const incidentMap: Record<string, IncidentGroup> = {};
for (const s of SHIFTS) {
  kbAll.push(...s.kb);
  invAll.push(...s.inventory);
  adAll.push(...s.adUsers);
  for (const it of s.items) {
    if (it.incident) {
      const g = it.incident.group;
      if (!incidentMap[g]) incidentMap[g] = { group: g, track: s.track, items: [] };
      incidentMap[g].items.push(it);
    } else {
      basePool.push({ item: it, track: s.track });
    }
  }
}

/** Full incident groups (root + duplicates), for the Doubles modifier. */
export const INCIDENT_GROUPS: IncidentGroup[] = Object.values(incidentMap);

// Extra authored tickets. Each entry carries track/difficulty/reward/xp metadata
// plus the ticket content (and an optional inline kbArticle we fold into the KB).
const extraPool: PoolEntry[] = [];
for (const raw of extraRaw as Array<Record<string, unknown>>) {
  const e = raw as Record<string, unknown>;
  const track = e.track as Track;
  const difficulty = e.difficulty as string | undefined;
  const kbArticle = e.kbArticle as KbArticle | undefined;
  const rw = REWARD_BY_DIFF[difficulty ?? ""] ?? { reward: 45, xp: 35 };

  const content: Record<string, unknown> = { ...e };
  delete content.track;
  delete content.difficulty;
  delete content.kbArticle;

  let kbArticleId = content.kbArticleId as string | undefined;
  if (kbArticle) { kbAll.push(kbArticle); kbArticleId = kbArticle.id; }

  const item = {
    ...content,
    reward: (e.reward as number) ?? rw.reward,
    xp: (e.xp as number) ?? rw.xp,
    slaMinutes: (content.slaMinutes as number) ?? 20,
    arriveAfter: 0,
    ...(kbArticleId ? { kbArticleId } : {}),
  } as unknown as ShiftItem;

  extraPool.push({ item, track });
}

export const POOL: PoolEntry[] = [...basePool, ...extraPool];
export const MASTER_KB: KbArticle[] = dedupBy(kbAll, (k) => k.id);
export const MASTER_INVENTORY: InventoryItem[] = dedupBy(invAll, (i) => i.sku);
export const MASTER_AD: AdUser[] = dedupBy(adAll, (u) => u.username);
