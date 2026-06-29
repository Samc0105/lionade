// LionDesk game engine. The pure, framework-free core of the shift simulator.
//
// Everything here is plain TypeScript with NO React / DOM / Audio imports, so it
// can be unit-tested in isolation and imported on the server. It was extracted
// out of components/liondesk/LionDesk.tsx (which kept only the React components
// and effects) so the highest-value, most regression-prone logic (the reducer,
// the SLA/patience/streak math, scoring) is reachable without rendering React.
//
// The economy stays server-authoritative: the Fangs/XP a shift reports here are
// a PREVIEW. Real granting is validated + clamped in app/api/techhub/shifts/
// complete. Never grant from the client.

import type { AppId, ShiftItem, Shift, Priority } from "@/lib/liondesk/types";
import { gradeFor, PASS_SCORE } from "@/lib/liondesk/scoring";

/** The result a finished shift reports up to the campaign (preview economy). */
export interface ShiftResult {
  shiftId: string;
  score: number;
  grade: string;
  csat: number;
  fangs: number;
  xp: number;
  resolved: number;
  total: number;
  difficulty: "easy" | "normal" | "hard";
  usedLifeline: boolean;
  bestStreak: number;
  /**
   * Preview mirror of how the server weights this shift's Fang ceiling for how
   * it was played (difficulty, clean clear, best streak), as a 0..1 factor.
   * Display only: the server owns the per-shift ceiling and the real, clamped
   * grant. This never grants on its own. See payoutWeight / shiftPayout below.
   */
  payoutFactor: number;
}

/* ───────────────────────── state ───────────────────────── */

export type ItemStatus = "queued" | "resolved" | "escalated" | "archived" | "reported" | "mishandled";
export const TERMINAL_STATUSES: ItemStatus[] = ["resolved", "escalated", "archived", "reported", "mishandled"];
export const isTerminal = (s: ItemStatus) => TERMINAL_STATUSES.includes(s);

export type FeedTone = "good" | "bad" | "info";
export interface FeedEntry { seq: number; text: string; tone: FeedTone }

export interface ItemRuntime { status: ItemStatus; steps: string[]; attempts: number; chosenActionId: string | null; phoneChoice: number | null; breached: boolean; landedAt: number | null; patience: number | null; opened: boolean }

export const GOOD_FOR_REVEAL: ItemStatus[] = ["resolved", "escalated", "archived", "reported"];
/** A chained follow-up (revealedBy) is "live" only once its trigger matched. A
 *  non-follow-up item is always live. */
export function isLive(i: ShiftItem, m: Record<string, ItemRuntime>): boolean {
  if (!i.revealedBy) return true;
  const st = m[i.revealedBy.itemId]?.status;
  if (!st) return false;
  return i.revealedBy.on === "resolve" ? GOOD_FOR_REVEAL.includes(st) : st === "mishandled";
}

/** A MAJOR incident is "open" while any incident root is live and unresolved.
 *  The Bridge Pressure meter climbs while this holds and stands down once the
 *  root (or, in a phased boss, the final root) is fixed. Read-only and pure. */
export function majorIncidentOpen(shift: Shift, items: Record<string, ItemRuntime>): boolean {
  return shift.items.some((i) => i.incident?.root && isLive(i, items) && !isTerminal(items[i.id].status));
}

/** A part on the way: deducted from budget at order time, lands in stock at its ETA. */
export interface PendingOrder { seq: number; sku: string; arrivesAt: number }

export interface State {
  secondsLeft: number;
  started: boolean;
  difficulty: Difficulty;
  ended: boolean;
  csat: number;
  fangs: number;
  xp: number;
  budget: number;
  stock: Record<string, number>;
  pendingOrders: PendingOrder[];
  orderSeq: number;
  adStatus: Record<string, string>;
  kbRead: string[];
  activeApp: AppId;
  activeItemId: string | null;
  items: Record<string, ItemRuntime>;
  feed: FeedEntry[];
  feedSeq: number;
  // Session-local lifelines (no economy). Coffee resets a call's patience;
  // a senior reveals the right move on the open item. Spend them wisely.
  lifelines: { coffee: number; senior: number };
  revealed: string[];
  // Consecutive correct resolves. Builds a Fangs/XP preview multiplier; a wrong
  // move resets it. Preview-only; the server still clamps the real grant.
  streak: number;
  bestStreak: number;
  // Bridge Pressure: a rising-tension meter for a MAJOR incident. It climbs each
  // second while any incident root is live and unresolved (the whole org is on
  // the incident bridge) and eases once the root is fixed and the bridge stands
  // down. bridgeStage is the highest tension stage the room has reacted to, so
  // each reaction fires once. This is pure tension plus room chatter: it never
  // grants or clamps Fangs, so the economy stays server-authoritative.
  bridgePressure: number;
  bridgeStage: number;
}

export type Action =
  | { t: "TICK" }
  | { t: "START"; difficulty: Difficulty }
  | { t: "APP"; app: AppId }
  | { t: "OPEN"; id: string }
  | { t: "CLOSE" }
  | { t: "STEP"; id: string; step: string }
  | { t: "KB"; articleId: string }
  | { t: "AD"; username: string; action: string }
  | { t: "ORDER"; sku: string }
  | { t: "SHIP"; sku: string }
  | { t: "PHONE"; id: string; index: number; correct: boolean }
  | { t: "RESOLVE"; id: string; actionId: string }
  | { t: "COFFEE" }
  | { t: "SENIOR"; id: string }
  | { t: "PING"; text: string }
  | { t: "END" };

export const clamp = (n: number) => Math.max(0, Math.min(100, n));

// Live SLA: a ticket must be resolved within this many shift-seconds of landing
// (by priority) or it breaches, costing CSAT. The fictional "SLA 15m" label is
// flavor; this is the real clock. Budgets are generous so a focused player
// rarely breaches, but ignoring a P1 to chase a P4 stings.
export const SLA_BUDGET: Record<Priority, number> = { P1: 120, P2: 200, P3: 300, P4: 420 };
export const BREACH_PENALTY: Record<Priority, number> = { P1: 10, P2: 7, P3: 5, P4: 3 };
// Stockroom orders are not instant. A part takes this long (shift-seconds) to
// arrive. This is the "teeth": you have to order the part before the SLA clock
// runs out, not when you get around to it. Resolution order: the item's own
// leadSeconds, then a per-vendor default, then DEFAULT_LEAD. Faster vendors are
// the express lane; CDW-grade hardware vendors are slower.
export const DEFAULT_LEAD = 30;
export const VENDOR_LEAD: Record<string, number> = { "Amazon Biz": 18, Newegg: 28, CDW: 42, Dell: 45, Apple: 38 };
// Phone-call patience: a caller you've picked up loses patience every second you
// stay on the line without pinning the issue. A wrong diagnostic question costs a
// chunk. Hit zero and they hang up, which is a mishandled call plus a CSAT hit.
export const PATIENCE_DECAY = 2;
export const PATIENCE_WRONG = 18;
export const PATIENCE_HANGUP_PENALTY = 12;

// Bridge Pressure: while a major incident (an open incident root) stays
// unresolved, the whole org is on an incident bridge and the tension climbs each
// second. It rises faster on harder difficulties (reusing the patience scale)
// and eases (faster than it rises, so the stand down feels like relief) once the
// root is fixed. Stage thresholds drive the room's reactions. This is flavor and
// chatter only: it never grants or clamps Fangs, so the economy stays
// server-authoritative.
export const BRIDGE_RISE = 1.5;
export const BRIDGE_EASE = 4;
export const BRIDGE_STAGE_1 = 34;
export const BRIDGE_STAGE_2 = 67;
export const BRIDGE_STAGE_3 = 100;
// What the room says as the bridge heats up, indexed by stage (1..3). Index 0 is
// unused so a stage number maps straight to its line.
export const BRIDGE_LINES: string[] = [
  "",
  "Incident bridge is live. The whole floor is watching this one.",
  "Leadership joined the bridge. Eyes are on you. Find the root and fix it.",
  "The bridge is white hot. Every minute this stays open hurts. Fix the root.",
];

// Difficulty scales the whole desk: how much SLA budget you get, how hard wrong
// moves and breaches hit, how fast callers lose patience, how many lifelines you
// start with, and how many tries you get on each item before it locks. Picked at
// clock-in.
//
// Balance pass (Idea 24): now that the SLA breach sweep actually fires (the TICK
// case commits the landedAt stamp every tick), the per-difficulty `pen` factor
// scales a real, live penalty. `pen` is the SLA breach penalty multiplier and its
// only consumer; before the sweep fix it was effectively dead. Easy was softened
// to 0.5 and Hard sharpened to 1.5 so the SLA breach hit differs meaningfully
// across tiers (Easy 0.5x, Normal 1x, Hard 1.5x of the base BREACH_PENALTY). The
// SLA budget multipliers (1.4 / 1.0 / 0.75) and patience multipliers (0.6 / 1.0 /
// 1.5) already gave a clear spread and were reviewed and held. Lifeline
// allotments (Easy 5, Normal 3, Hard 1) and tries per item (3 / 2 / 1) were
// reviewed and held too: they already form a fair ladder, and the clean clear
// payout bonus rewards not leaning on them. Normal stays the 1.0 baseline.
export type Difficulty = "easy" | "normal" | "hard";
export const DIFF: Record<Difficulty, { sla: number; pen: number; patience: number; csat: number; coffee: number; senior: number; attempts: number; label: string; desc: string }> = {
  easy: { sla: 1.4, pen: 0.5, patience: 0.6, csat: 0.7, coffee: 2, senior: 3, attempts: 3, label: "Easy", desc: "Generous clock, softer penalties, extra lifelines, 3 tries per item." },
  normal: { sla: 1.0, pen: 1.0, patience: 1.0, csat: 1.0, coffee: 1, senior: 2, attempts: 2, label: "Normal", desc: "The standard desk. 2 tries per item." },
  hard: { sla: 0.75, pen: 1.5, patience: 1.5, csat: 1.3, coffee: 0, senior: 1, attempts: 1, label: "Hard", desc: "Tight SLAs, harsh penalties, one lifeline, one try per item." },
};
export function slaBudget(shift: Shift, p: Priority, diff: Difficulty): number {
  return SLA_BUDGET[p] * (shift.slaScale ?? 1) * DIFF[diff].sla;
}
export function leadFor(p: { leadSeconds?: number; vendor: string }): number {
  return p.leadSeconds ?? VENDOR_LEAD[p.vendor] ?? DEFAULT_LEAD;
}

export function buildInitial(shift: Shift): State {
  const items: Record<string, ItemRuntime> = {};
  shift.items.forEach((i) => { items[i.id] = { status: "queued", steps: [], attempts: 0, chosenActionId: null, phoneChoice: null, breached: false, landedAt: null, patience: i.channel === "phone" ? 100 : null, opened: false }; });
  const stock: Record<string, number> = {};
  shift.inventory.forEach((p) => { stock[p.sku] = p.stock; });
  const adStatus: Record<string, string> = {};
  shift.adUsers.forEach((u) => { adStatus[u.username] = u.status; });
  return {
    secondsLeft: shift.durationSeconds,
    started: false,
    difficulty: "normal",
    ended: false,
    csat: 100,
    fangs: 0,
    xp: 0,
    budget: shift.startingBudget,
    stock,
    pendingOrders: [],
    orderSeq: 0,
    adStatus,
    kbRead: [],
    activeApp: "tickets",
    activeItemId: null,
    items,
    feed: [],
    feedSeq: 0,
    // START sets the real lifeline counts from the chosen difficulty; the desk
    // is unreachable until then, so these baselines stay zero.
    lifelines: { coffee: 0, senior: 0 },
    revealed: [],
    streak: 0,
    bestStreak: 0,
    bridgePressure: 0,
    bridgeStage: 0,
  };
}

export function pushFeed(s: State, text: string, tone: FeedTone): State {
  const seq = s.feedSeq + 1;
  return { ...s, feedSeq: seq, feed: [...s.feed, { seq, text, tone }].slice(-4) };
}

export function makeReducer(shift: Shift) {
  return function reducer(state: State, a: Action): State {
    if (state.ended && a.t !== "END") return state;
    switch (a.t) {
      case "TICK": {
        const nextLeft = state.secondsLeft <= 1 ? 0 : state.secondsLeft - 1;
        const elapsed = shift.durationSeconds - nextLeft;
        let ns: State = { ...state, secondsLeft: nextLeft };

        // SLA breach sweep: any landed, unresolved, not-yet-breached ticket past
        // its deadline breaches now (one-time CSAT hit, heavier for VIPs).
        let items = ns.items;
        let csat = ns.csat;
        const breached: { subject: string; vip: boolean }[] = [];
        shift.items.forEach((i) => {
          let it = items[i.id];
          if (isTerminal(it.status) || !isLive(i, items) || elapsed < i.arriveAfter) return;
          // Stamp the moment it actually landed (revealed callbacks land late, so
          // their SLA must start from here, not from a static arriveAfter of 0).
          const landedAt = it.landedAt ?? elapsed;
          if (it.landedAt == null) { it = { ...it, landedAt }; items = { ...items, [i.id]: it }; }
          if (it.breached) return;
          if (elapsed >= landedAt + slaBudget(shift, i.priority, ns.difficulty)) {
            const base = BREACH_PENALTY[i.priority] * DIFF[ns.difficulty].pen;
            // A breached VIP escalates to your manager: it hurts more.
            const pen = Math.round(i.from.vip ? base * 2 : base);
            items = { ...items, [i.id]: { ...it, breached: true } };
            csat = clamp(csat - pen);
            breached.push({ subject: i.subject, vip: !!i.from.vip });
          }
        });
        // Commit the SLA sweep UNCONDITIONALLY. The landedAt stamp (plus any breach
        // flag and CSAT hit) must persist on EVERY tick, not only when a breach was
        // recorded. The old code committed `items`/`csat` to ns only inside
        // `if (breached.length)`, so a freshly landed item computed its landedAt into
        // the local copy and then threw it away; the next tick re-stamped landedAt to
        // the new elapsed, the deadline never actually arrived, and SLA breaches never
        // fired (the whole SLA-pressure mechanic was dead). When nothing landed or
        // breached this is a no op (items and csat are unchanged), so committing every
        // tick is safe and behavior preserving for the no-breach path.
        ns = { ...ns, items, csat };
        if (breached.length) {
          breached.forEach((b) => { ns = pushFeed(ns, b.vip ? `Escalated to your manager: ${b.subject}` : `SLA breach: ${b.subject}`, "bad"); });
        }

        // Stockroom deliveries: any ordered part that has reached its ETA lands now.
        if (ns.pendingOrders.length) {
          const arrived = ns.pendingOrders.filter((o) => elapsed >= o.arrivesAt);
          if (arrived.length) {
            let stock = ns.stock;
            arrived.forEach((o) => { stock = { ...stock, [o.sku]: (stock[o.sku] ?? 0) + 1 }; });
            ns = { ...ns, stock, pendingOrders: ns.pendingOrders.filter((o) => elapsed < o.arrivesAt) };
            arrived.forEach((o) => {
              const part = shift.inventory.find((p) => p.sku === o.sku);
              ns = pushFeed(ns, `Delivered: ${part?.name ?? o.sku} is in the stockroom.`, "good");
            });
          }
        }

        // Phone patience: once a call is picked up (opened), the caller drains
        // until you pin the issue, whether or not the call is the open tab. Hit
        // zero and they hang up (a mishandled call).
        let hungUp = false;
        for (const ai of shift.items) {
          if (ai.channel !== "phone") continue;
          const rt = ns.items[ai.id];
          if (!rt.opened || isTerminal(rt.status) || rt.patience == null || rt.steps.includes("phone") || elapsed < ai.arriveAfter) continue;
          const np = rt.patience - PATIENCE_DECAY * DIFF[ns.difficulty].patience;
          if (np <= 0) {
            ns = { ...ns, items: { ...ns.items, [ai.id]: { ...rt, patience: 0, status: "mishandled", attempts: rt.attempts + 1 } }, csat: clamp(ns.csat - PATIENCE_HANGUP_PENALTY), streak: 0 };
            if (ns.activeItemId === ai.id) ns = { ...ns, activeItemId: null };
            ns = pushFeed(ns, `The caller hung up: ${ai.subject}. Pick up and ask the right question sooner.`, "bad");
            hungUp = true;
          } else {
            ns = { ...ns, items: { ...ns.items, [ai.id]: { ...rt, patience: np } } };
          }
        }
        if (hungUp && shift.items.every((i) => isTerminal(ns.items[i.id].status) || !isLive(i, ns.items))) ns = { ...ns, ended: true };

        // Bridge Pressure: a major incident keeps the org on an incident bridge.
        // Tension climbs while an incident root is open and the room reacts at
        // each stage; it eases once the last root is fixed and the bridge stands
        // down. Pure tension plus chatter, never Fangs.
        const bridgeOpen = majorIncidentOpen(shift, ns.items);
        const nextPressure = bridgeOpen
          ? clamp(ns.bridgePressure + BRIDGE_RISE * DIFF[ns.difficulty].patience)
          : Math.max(0, ns.bridgePressure - BRIDGE_EASE);
        ns = { ...ns, bridgePressure: nextPressure };
        if (bridgeOpen) {
          const stage = nextPressure >= BRIDGE_STAGE_3 ? 3 : nextPressure >= BRIDGE_STAGE_2 ? 2 : nextPressure >= BRIDGE_STAGE_1 ? 1 : 0;
          if (stage > ns.bridgeStage) {
            ns = { ...ns, bridgeStage: stage };
            ns = pushFeed(ns, BRIDGE_LINES[stage], stage >= 2 ? "bad" : "info");
          }
        } else if (ns.bridgeStage > 0) {
          // The last incident root is fixed: the bridge stands down (once).
          ns = { ...ns, bridgeStage: 0 };
          ns = pushFeed(ns, "Major incident resolved. The bridge stands down. Strong work under pressure.", "good");
        }

        if (nextLeft === 0) ns = { ...ns, ended: true };
        return ns;
      }
      case "APP":
        return { ...state, activeApp: a.app, activeItemId: null };
      case "OPEN": {
        // Opening a call is picking it up. From then on the caller's patience
        // keeps draining even if you navigate away (they are on hold), so you
        // cannot peek at a call and close it to dodge the clock.
        const it = state.items[a.id];
        const items = it && !it.opened ? { ...state.items, [a.id]: { ...it, opened: true } } : state.items;
        return { ...state, activeItemId: a.id, items };
      }
      case "CLOSE":
        return { ...state, activeItemId: null };
      case "STEP": {
        const it = state.items[a.id];
        if (it.steps.includes(a.step)) return state;
        return { ...state, items: { ...state.items, [a.id]: { ...it, steps: [...it.steps, a.step] } } };
      }
      case "KB": {
        if (state.kbRead.includes(a.articleId)) return state;
        return { ...state, kbRead: [...state.kbRead, a.articleId] };
      }
      case "AD": {
        // Mark the matching item's "ad" step + flip the directory status for display.
        let items = state.items;
        shift.items.forEach((i) => {
          if (i.ad && i.ad.username === a.username && i.ad.action === a.action) {
            const it = items[i.id];
            if (!it.steps.includes("ad")) items = { ...items, [i.id]: { ...it, steps: [...it.steps, "ad"] } };
          }
        });
        const adStatus = { ...state.adStatus };
        if (a.action === "unlock") adStatus[a.username] = "active";
        if (a.action === "reset_pw") adStatus[a.username] = "active";
        let ns = { ...state, items, adStatus };
        ns = pushFeed(ns, `Admin: ran ${a.action.replace("_", " ")} on ${a.username}.`, "info");
        return ns;
      }
      case "ORDER": {
        const part = shift.inventory.find((p) => p.sku === a.sku)!;
        if (state.budget < part.unitCost) return pushFeed(state, "Order denied: not enough budget.", "bad");
        const elapsed = shift.durationSeconds - state.secondsLeft;
        const lead = leadFor(part);
        const seq = state.orderSeq + 1;
        const ns: State = {
          ...state,
          budget: state.budget - part.unitCost,
          orderSeq: seq,
          pendingOrders: [...state.pendingOrders, { seq, sku: a.sku, arrivesAt: elapsed + lead }],
        };
        return pushFeed(ns, `Ordered 1x ${part.name} from ${part.vendor} for $${part.unitCost}. ETA ${lead}s.`, "info");
      }
      case "SHIP": {
        if ((state.stock[a.sku] ?? 0) <= 0) return pushFeed(state, "Out of stock. Order one first.", "bad");
        let items = state.items;
        shift.items.forEach((i) => {
          if (i.part && i.part.sku === a.sku) {
            const it = items[i.id];
            if (!it.steps.includes("part")) items = { ...items, [i.id]: { ...it, steps: [...it.steps, "part"] } };
          }
        });
        const part = shift.inventory.find((p) => p.sku === a.sku)!;
        return pushFeed({ ...state, items, stock: { ...state.stock, [a.sku]: state.stock[a.sku] - 1 } }, `Shipped ${part.name} to the user.`, "info");
      }
      case "PHONE": {
        const it = state.items[a.id];
        let steps = it.steps;
        let patience = it.patience;
        if (a.correct) {
          if (!steps.includes("phone")) steps = [...steps, "phone"];
        } else if (patience != null) {
          patience = Math.max(0, patience - PATIENCE_WRONG);
        }
        let ns: State = { ...state, items: { ...state.items, [a.id]: { ...it, steps, phoneChoice: a.index, patience } } };
        if (!a.correct) {
          if (patience === 0) {
            ns = { ...ns, items: { ...ns.items, [a.id]: { ...ns.items[a.id], status: "mishandled", attempts: it.attempts + 1 } }, csat: clamp(ns.csat - PATIENCE_HANGUP_PENALTY), activeItemId: null, streak: 0 };
            ns = pushFeed(ns, "The caller hung up. Too many wrong questions.", "bad");
          } else {
            ns = pushFeed(ns, "That wasn't what they needed. They're getting impatient.", "bad");
          }
        }
        return ns;
      }
      case "RESOLVE": {
        const item = shift.items.find((i) => i.id === a.id)!;
        const it = state.items[item.id];
        if (isTerminal(it.status)) return state;
        const action = item.actions.find((x) => x.id === a.actionId)!;
        const missing = (action.requires ?? []).filter((r) =>
          r === "kb" ? !state.kbRead.includes(item.kbArticleId ?? "") : !it.steps.includes(r),
        );
        if (missing.length) {
          return pushFeed(state, "Hold on. You haven't confirmed the cause yet. Use your tools first.", "info");
        }
        const correct = !!action.correct;
        // Ignore an accidental double-commit of the SAME wrong card (e.g. a fast
        // double-click): re-picking the identical wrong action is a no-op and does
        // not burn another try. Picking a DIFFERENT wrong card still costs one.
        if (!correct && a.actionId === it.chosenActionId) return state;
        // Commit-your-fix: every wrong non-ending pick burns a try (the requires
        // gate above returns early, so a not-yet-diagnosed block never costs one).
        // Run out of tries and the item locks as mishandled, so the player has to
        // read the evidence before committing instead of brute-forcing the cards.
        const nextAttempts = it.attempts + 1;
        const outOfTries = !correct && !action.ends && nextAttempts >= DIFF[state.difficulty].attempts;
        let newStatus: ItemStatus = it.status;
        if (correct) newStatus = (action.outcome as ItemStatus) ?? "resolved";
        else if (action.ends) newStatus = (action.outcome as ItemStatus) ?? "mishandled";
        else if (outOfTries) newStatus = "mishandled";
        // VIP weighting: they notice great service and remember a botched call.
        let csatDelta = action.csat;
        if (item.from.vip) {
          if (correct) csatDelta += 2;
          else if (action.ends) csatDelta -= 3;
        }
        // Difficulty + Audit/Graveyard: wrong moves cost more (or less, on Easy).
        if (csatDelta < 0) {
          let scaled = csatDelta * DIFF[state.difficulty].csat;
          if (shift.penaltyScale) scaled *= shift.penaltyScale;
          csatDelta = Math.round(scaled);
        }
        const csat = clamp(state.csat + csatDelta);
        // Resolve streak: consecutive correct fixes build a preview multiplier.
        const streak = correct ? state.streak + 1 : 0;
        const mult = correct ? (streak >= 8 ? 1.75 : streak >= 5 ? 1.5 : streak >= 3 ? 1.25 : 1) : 1;
        let ns: State = {
          ...state,
          csat,
          fangs: state.fangs + (correct ? Math.round(item.reward * mult) : 0),
          xp: state.xp + (correct ? Math.round(item.xp * mult) : 0),
          streak,
          bestStreak: Math.max(state.bestStreak, streak),
          items: { ...state.items, [item.id]: { ...it, status: newStatus, attempts: nextAttempts, chosenActionId: a.actionId } },
        };
        ns = pushFeed(ns, action.teach, correct ? "good" : "bad");
        if (correct && (streak === 3 || streak === 5 || streak === 8 || streak === 12)) {
          ns = pushFeed(ns, `On a roll: ${streak} in a row. Fangs x${mult}.`, "good");
        }
        // Out of tries: the item is locked. The teach above still fired, and the
        // shift report shows the correct move, so the miss is a lesson, not a wall.
        // (The remaining tries are shown live on the action panel, so a wrong-but-
        // retryable move does not need its own toast on top of the teach.)
        if (outOfTries) {
          ns = pushFeed(ns, "Out of tries on this one. It is marked mishandled. The right move is in your shift report.", "bad");
        }

        // Incident storm: correctly fixing the root cause mass-resolves the
        // flood of duplicate tickets behind it. One root cause, one fix.
        if (correct && item.incident?.root) {
          let dupItems = ns.items;
          let n = 0;
          shift.items.forEach((d) => {
            if (d.incident && d.incident.group === item.incident!.group && d.id !== item.id && !isTerminal(dupItems[d.id].status)) {
              dupItems = { ...dupItems, [d.id]: { ...dupItems[d.id], status: "resolved" } };
              n++;
            }
          });
          if (n > 0) {
            ns = { ...ns, items: dupItems };
            ns = pushFeed(ns, `Mass-resolved ${n} duplicate ticket${n === 1 ? "" : "s"} from the same incident.`, "good");
          }
        }

        if (isTerminal(newStatus)) ns = { ...ns, activeItemId: null };
        const allDone = shift.items.every((i) => isTerminal(ns.items[i.id].status) || !isLive(i, ns.items));
        if (allDone) ns = { ...ns, ended: true };
        return ns;
      }
      case "COFFEE": {
        if (state.lifelines.coffee <= 0) return state;
        const ai = state.activeItemId ? shift.items.find((i) => i.id === state.activeItemId) : null;
        if (!ai || ai.channel !== "phone") return pushFeed(state, "Coffee steadies you on a live call. Open the call first.", "info");
        const rt = state.items[ai.id];
        if (isTerminal(rt.status) || rt.steps.includes("phone")) return state;
        return pushFeed(
          { ...state, lifelines: { ...state.lifelines, coffee: state.lifelines.coffee - 1 }, items: { ...state.items, [ai.id]: { ...rt, patience: 100 } } },
          "You took a breath and a sip. The caller's patience is reset.", "good",
        );
      }
      case "SENIOR": {
        if (state.lifelines.senior <= 0 || state.revealed.includes(a.id)) return state;
        const item = shift.items.find((i) => i.id === a.id);
        if (!item || isTerminal(state.items[a.id].status)) return state;
        return pushFeed(
          { ...state, lifelines: { ...state.lifelines, senior: state.lifelines.senior - 1 }, revealed: [...state.revealed, a.id] },
          "A senior leans over: go with the highlighted move.", "info",
        );
      }
      case "PING":
        return pushFeed(state, a.text, "info");
      case "START":
        return state.started ? state : { ...state, started: true, difficulty: a.difficulty, lifelines: { coffee: DIFF[a.difficulty].coffee, senior: DIFF[a.difficulty].senior } };
      case "END":
        return { ...state, ended: true };
      default:
        return state;
    }
  };
}

export const GOOD_STATUSES: ItemStatus[] = ["resolved", "escalated", "archived", "reported"];

/* ─────────────────── difficulty-weighted payout ─────────────────── */
// One source of truth for how a shift's Fang reward is weighted by HOW it was
// played. Each shift's SHIFT_REWARDS maxFangs (server-owned, in the completion
// route) is the HARD ceiling. Easy and Normal scale down by fixed factors, a
// clean clear (no lifeline spent) earns a small bonus, and a long best streak
// adds a tiny one. The combined weight is clamped to 1.0 so Hard plus every
// bonus can never pay above the ceiling. The server completion route applies
// this to the authoritative, clamped, idempotent grant; the engine preview
// applies the same weight for display only and grants nothing.

/**
 * Each difficulty's share of the HARD Fang ceiling. Hard pays the full ceiling;
 * Normal and Easy scale down by a flat step of 0.2 per tier (Easy 0.6, Normal
 * 0.8, Hard 1.0). Balance pass (Idea 24): the old spread (0.7 / 0.85 / 1.0) made
 * a Hard clear worth only about 1.4x an Easy clear at equal score, so the tier
 * you picked barely moved the reward. A flat 0.2 step makes Hard worth about
 * 1.67x an Easy clear, so choosing the harder desk is a real, fair economic
 * decision, while every tier still clears and pays. Preview only; the server
 * owns the clamped grant, so the economy stays server authoritative.
 */
export const PAYOUT_DIFFICULTY_FACTOR: Record<Difficulty, number> = { easy: 0.6, normal: 0.8, hard: 1 };
/**
 * Bonus share for clearing a shift without spending a lifeline. Held at 0.05 in
 * the balance pass: a clean clear is a modest, bounded nudge to play without
 * help, not a payout lever. Even stacked with the full streak bonus it leaves
 * Normal at 0.93 and Easy at 0.73, both below the Hard ceiling factor of 1.0, so
 * no amount of bonus on a lower tier can ever match a Hard clear. Fair by design.
 */
export const PAYOUT_CLEAN_CLEAR_BONUS = 0.05;
/**
 * Bonus share per best-streak point, and the cap on the total streak bonus. The
 * cap (0.08) is reached at a best streak of 8, the same streak where the in-shift
 * Fang multiplier ladder tops out at x1.75. Balance pass: aligning the two "max
 * streak" points (the cap was 0.1, reached at 10) means a player who maxes the
 * live multiplier ladder also maxes the payout streak bonus, with no reason to
 * chase streak past the ladder's top. The step stays 0.01 for a gentle, linear
 * ramp.
 */
export const PAYOUT_STREAK_STEP = 0.01;
export const PAYOUT_STREAK_MAX = 0.08;

/**
 * The 0..1 weight applied to a shift's HARD Fang ceiling for how it was played.
 * Clamped to 1 so Hard plus every bonus stays at the ceiling and never exceeds
 * it. Pure and side effect free: the server grant and the client preview both
 * read this, so they can never disagree on the weighting. It only shapes the
 * (clamped) amount, it never grants. The economy stays server-authoritative.
 */
export function payoutWeight(difficulty: Difficulty, usedLifeline: boolean, bestStreak: number): number {
  const base = PAYOUT_DIFFICULTY_FACTOR[difficulty] ?? PAYOUT_DIFFICULTY_FACTOR.hard;
  const clean = usedLifeline ? 0 : PAYOUT_CLEAN_CLEAR_BONUS;
  const streak = Math.min(PAYOUT_STREAK_MAX, Math.max(0, bestStreak) * PAYOUT_STREAK_STEP);
  return Math.min(1, base + clean + streak);
}

/**
 * The difficulty-weighted Fang payout for a clear, clamped to its HARD ceiling.
 * `maxFangs` is that ceiling (SHIFT_REWARDS.maxFangs on the server). A score
 * below PASS_SCORE banks nothing, matching the clear gate. This is the ONE
 * payout formula: the server completion route calls it for the authoritative,
 * idempotent, clamped grant, and any preview can call it for a display-only
 * mirror that grants nothing. With difficulty "hard", no lifeline penalty, and
 * a zero streak it reduces to round(maxFangs * score/100), the prior flat math.
 */
export function shiftPayout(maxFangs: number, score: number, difficulty: Difficulty, usedLifeline: boolean, bestStreak: number): number {
  const ceiling = Math.max(0, Math.round(maxFangs));
  const cleared = Math.max(0, Math.min(100, Math.round(score)));
  if (ceiling <= 0 || cleared < PASS_SCORE) return 0;
  const weighted = ceiling * (cleared / 100) * payoutWeight(difficulty, usedLifeline, bestStreak);
  return Math.min(ceiling, Math.round(weighted));
}

export function computeResult(shift: Shift, state: State): ShiftResult {
  const live = shift.items.filter((i) => isLive(i, state.items));
  const resolved = live.filter((i) => GOOD_STATUSES.includes(state.items[i.id].status)).length;
  const total = Math.max(1, live.length);
  const score = Math.round(state.csat * 0.6 + (resolved / total) * 40);
  const grade = gradeFor(score);
  const usedLifeline = (DIFF[state.difficulty].coffee - state.lifelines.coffee) > 0 || (DIFF[state.difficulty].senior - state.lifelines.senior) > 0;
  // Preview mirror of the server's difficulty weighting (display only, grants
  // nothing). The absolute Fang ceiling is server-owned, so the engine reports
  // the weight; the server multiplies it into the real, clamped grant.
  const payoutFactor = payoutWeight(state.difficulty, usedLifeline, state.bestStreak);
  return { shiftId: shift.id, score, grade, csat: state.csat, fangs: state.fangs, xp: state.xp, resolved, total, difficulty: state.difficulty, usedLifeline, bestStreak: state.bestStreak, payoutFactor };
}
