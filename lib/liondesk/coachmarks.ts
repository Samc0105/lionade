// Guided first shift coach marks for LionDesk. A calm, one time teaching layer:
// the first time the player meets each desk surface or ticket type (a terminal
// ticket, a phone call, a phishing email, a stockroom order, a major incident),
// a brief contextual tip appears once and is never shown again.
//
// Local only (client). Purely cosmetic: it grants nothing, blocks nothing, and
// the economy stays server authoritative. The seen state is kept in localStorage
// so each tip fires at most once ever, across every shift. No forbidden dashes
// appear in any copy below; guidance uses commas, periods, parentheses, or "to".

import type { ShiftItem } from "./types";

export type CoachMarkId = "terminal" | "phone" | "phishing" | "stockroom" | "incident";

export interface CoachMarkDef {
  id: CoachMarkId;
  /** Short heading. */
  title: string;
  /** One or two calm sentences of guidance. */
  body: string;
}

// Authored copy for each surface. Dash free, and it never names a currency other
// than Fangs.
export const COACH_MARKS: Record<CoachMarkId, CoachMarkDef> = {
  terminal: {
    id: "terminal",
    title: "Investigate first",
    body: "This ticket has a terminal. Run a command or two (use the buttons under it) to find the real problem before you pick your fix.",
  },
  phone: {
    id: "phone",
    title: "You are on a call",
    body: "Callers lose patience while you talk. Ask the right question first to pin the issue, then choose your fix before they hang up.",
  },
  phishing: {
    id: "phishing",
    title: "Read the email closely",
    body: "Some mail is a trap. Check the sender, the links, and the urgency. When it smells like phishing, report it instead of clicking.",
  },
  stockroom: {
    id: "stockroom",
    title: "Order parts early",
    body: "Parts take time to arrive. If the stockroom is empty, order now so the part lands before the SLA runs out, then ship it to the user.",
  },
  incident: {
    id: "incident",
    title: "One root cause",
    body: "A major incident can spawn a flood of tickets. Find the root cause and fix it once to clear the whole group, instead of working each ticket alone.",
  },
};

const KEY = "lionade.techhub.coachmarks.v1";

type SeenStore = Record<string, boolean>;

function read(): SeenStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? (p as SeenStore) : {};
  } catch {
    return {};
  }
}

function save(s: SeenStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Whether the player has already seen a given coach mark. Client only. */
export function hasSeenCoachMark(id: CoachMarkId): boolean {
  return read()[id] === true;
}

/** Mark a coach mark as seen so it never fires again. Client only, idempotent. */
export function markCoachMarkSeen(id: CoachMarkId): void {
  if (typeof window === "undefined") return;
  const s = read();
  if (s[id]) return;
  s[id] = true;
  save(s);
}

/**
 * Every coach mark an opened item can teach, most specific first. An item can
 * match more than one surface (a phishing email that also exposes a terminal),
 * so the caller shows the first one the player has not seen yet. Pure and
 * deterministic, safe to call during render.
 */
export function coachMarksForItem(item: ShiftItem): CoachMarkId[] {
  const out: CoachMarkId[] = [];
  if (item.incident) out.push("incident");
  if (item.channel === "email" && item.email?.isPhish) out.push("phishing");
  if (item.channel === "phone") out.push("phone");
  if (item.commands && item.commands.length > 0) out.push("terminal");
  if (item.part) out.push("stockroom");
  return out;
}

/**
 * The first coach mark an opened item should teach that the player has not seen
 * yet, or null when there is nothing new to show. Reads localStorage, so call it
 * only after mount to avoid reading the seen state before it is known on the
 * client.
 */
export function nextCoachMarkForItem(item: ShiftItem): CoachMarkDef | null {
  const seen = read();
  for (const id of coachMarksForItem(item)) {
    if (!seen[id]) return COACH_MARKS[id];
  }
  return null;
}

/**
 * Pick the first unseen coach mark for an opened item and persist it as seen in
 * the same pass. Returns the mark to show, or null when there is nothing new.
 * This does a single localStorage read and at most one write, so the caller does
 * not have to find then mark in two separate steps (which would parse storage
 * twice). Client only, idempotent across remounts, and it keeps the at most once
 * guarantee. Call only after mount.
 */
export function takeNextCoachMark(item: ShiftItem): CoachMarkDef | null {
  const seen = read();
  for (const id of coachMarksForItem(item)) {
    if (!seen[id]) {
      seen[id] = true;
      save(seen);
      return COACH_MARKS[id];
    }
  }
  return null;
}

/** Clear all seen coach marks, so the guided first shift can run again. */
export function resetCoachMarks(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
