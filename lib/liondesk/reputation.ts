// Per-department reputation. Good service builds standing; breaches and botched
// VIP calls erode it. Local only. A coarse department is derived from each
// ticket's sender role so the handful of departments accrue over many shifts.

import type { Shift } from "./types";

export const REP_DEPTS = ["Finance", "Sales", "Engineering", "Marketing", "Security", "Leadership", "Operations"] as const;

export function departmentOf(role: string): string {
  const r = role.toLowerCase();
  if (/account|finance|payroll|billing/.test(r)) return "Finance";
  if (/sales/.test(r)) return "Sales";
  if (/eng|developer|\bswe\b|devops|\bsre\b|on-call|pager/.test(r)) return "Engineering";
  if (/market|design|brand/.test(r)) return "Marketing";
  if (/security|\bsoc\b|siem|\bir\b|dlp|edr/.test(r)) return "Security";
  if (/exec|ceo|\bvp\b|director|leadership|manager|people ops|\bhr\b/.test(r)) return "Leadership";
  return "Operations";
}

const KEY = "lionade.techhub.reputation.v1";

export function getReputation(): Record<string, number> {
  const base: Record<string, number> = {};
  for (const d of REP_DEPTS) base[d] = 50;
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}

function save(map: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Update standing for every department that had a ticket in the shift, based
 *  on how the shift went (overall satisfaction). */
export function recordShiftReputation(shift: Shift, csat: number): void {
  const delta = csat >= 85 ? 4 : csat >= 60 ? 1 : -4;
  const map = getReputation();
  const depts = new Set(shift.items.filter((i) => !i.revealedBy).map((i) => departmentOf(i.from.role)));
  depts.forEach((d) => { map[d] = Math.max(0, Math.min(100, (map[d] ?? 50) + delta)); });
  save(map);
}
