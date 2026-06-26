// LionDesk — a "shift on the IT help desk" simulator. A fake desktop OS where
// emails, tickets, and texts arrive; you triage them and resolve each one
// through the right surface (terminal, stockroom, knowledge base, admin
// console), then get scored at the end of the shift. All content is authored
// and deterministic (zero API cost).
//
// The economy stays server-authoritative: the Fangs/XP a shift reports are a
// preview. Real granting must be validated server-side. Never grant from the
// client.

import type { EvidencePanel, SimCommand, Track } from "@/lib/helpdesk/types";

export type AppId = "inbox" | "tickets" | "phone" | "inventory" | "kb" | "ad";
export type Channel = "email" | "ticket" | "phone";
export type Priority = "P1" | "P2" | "P3" | "P4";

export interface Sender {
  name: string;
  role: string;
  vip?: boolean;
}

/** A diagnostic question you can text back to a confused user. */
export interface PhoneFollowup {
  label: string; // what you reply
  reply: string; // what the user says back
  correct?: boolean; // the right question to ask first
}

export interface InventoryItem {
  sku: string;
  name: string;
  stock: number;
  vendor: string;
  unitCost: number;
}

export interface KbArticle {
  id: string;
  title: string;
  tags: string[];
  body: string[];
}

export interface AdUser {
  username: string;
  name: string;
  status: "active" | "locked" | "reset_required";
  mfa: "ok" | "drifted" | "unenrolled";
  group: string;
}

export type AdAction = "unlock" | "reset_pw" | "reset_mfa";

/** Outcome a resolve choice produces. */
export type Outcome = "resolved" | "escalated" | "archived" | "reported" | "mishandled";

/** A resolve choice. Generalizes the "pick your fix" card to every channel. */
export interface ActionCard {
  id: string;
  label: string;
  /** Optional second line, e.g. a code snippet or specifics. */
  detail?: string;
  /** The genuinely correct move. */
  correct?: boolean;
  /** Per-item step keys that must be done first, else a teaching block. */
  requires?: string[];
  /** Satisfaction delta (positive good, negative bad). */
  csat: number;
  /** Shown after the pick: the "why". */
  teach: string;
  /** What status the item lands in. Defaults to "resolved" (correct) or stays open (wrong). */
  outcome?: Outcome;
  /** A catastrophic wrong move that ends the item badly instead of letting you retry. */
  ends?: boolean;
}

export interface ShiftItem {
  id: string;
  channel: Channel;
  priority: Priority;
  from: Sender;
  subject: string;
  asset?: string;
  slaMinutes: number;
  /** Seconds into the shift before this lands in the queue. */
  arriveAfter: number;
  reward: number;
  xp: number;

  // ── channel content ──
  email?: { body: string; isPhish?: boolean };
  ticketBody?: string;
  phone?: { opener: string; followups: PhoneFollowup[] };

  // ── tools this item needs (each sets a per-item step when used) ──
  evidence?: EvidencePanel[];
  commands?: SimCommand[]; // terminal; a command's `step` marks that step done
  part?: { sku: string }; // shipping the part sets step "part"
  ad?: { username: string; action: AdAction }; // doing it sets step "ad"
  kbArticleId?: string; // reading it sets step "kb"

  /**
   * Incident grouping. Many items can belong to one root cause (an outage that
   * spawns a flood of duplicate tickets). Correctly resolving the `root` item
   * mass-resolves the rest of the group, teaching "find the incident, fix once".
   */
  incident?: { group: string; root?: boolean };

  // ── resolution ──
  actions: ActionCard[];
  goal: string;
  hint: string;
}

export interface Shift {
  id: string;
  track: Track;
  /** Order within the track's campaign (0 = first shift). */
  order: number;
  name: string;
  rank: string;
  /** Optional accent hex for the shift chrome. */
  accent?: string;
  durationSeconds: number;
  startingBudget: number;
  inventory: InventoryItem[];
  kb: KbArticle[];
  adUsers: AdUser[];
  items: ShiftItem[];
}
