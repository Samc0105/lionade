"use client";

import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type Dispatch, type ReactNode } from "react";
import {
  EnvelopeSimple, Ticket, DeviceMobile, Package, BookBookmark, IdentificationBadge,
  Clock, CheckCircle, ArrowLeft, MagnifyingGlass, Lightning, Trophy, ArrowClockwise,
  SpeakerHigh, SpeakerSlash,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { AppId, ShiftItem, Shift, Priority } from "@/lib/liondesk/types";
import { playArrival, playResolve, playBreach, playFail, playWin, resumeAudio, isMuted, setMuted } from "@/lib/liondesk/sound";

export interface ShiftResult {
  shiftId: string;
  score: number;
  grade: string;
  csat: number;
  fangs: number;
  xp: number;
  resolved: number;
  total: number;
}

/* ───────────────────────── state ───────────────────────── */

type ItemStatus = "queued" | "resolved" | "escalated" | "archived" | "reported" | "mishandled";
const TERMINAL_STATUSES: ItemStatus[] = ["resolved", "escalated", "archived", "reported", "mishandled"];
const isTerminal = (s: ItemStatus) => TERMINAL_STATUSES.includes(s);

type FeedTone = "good" | "bad" | "info";
interface FeedEntry { seq: number; text: string; tone: FeedTone }

interface ItemRuntime { status: ItemStatus; steps: string[]; attempts: number; phoneChoice: number | null; breached: boolean }

interface State {
  secondsLeft: number;
  ended: boolean;
  csat: number;
  fangs: number;
  xp: number;
  budget: number;
  stock: Record<string, number>;
  adStatus: Record<string, string>;
  kbRead: string[];
  activeApp: AppId;
  activeItemId: string | null;
  items: Record<string, ItemRuntime>;
  feed: FeedEntry[];
  feedSeq: number;
}

type Action =
  | { t: "TICK" }
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
  | { t: "END" };

const clamp = (n: number) => Math.max(0, Math.min(100, n));

// Live SLA: a ticket must be resolved within this many shift-seconds of landing
// (by priority) or it breaches, costing CSAT. The fictional "SLA 15m" label is
// flavor; this is the real clock. Budgets are generous so a focused player
// rarely breaches, but ignoring a P1 to chase a P4 stings.
const SLA_BUDGET: Record<Priority, number> = { P1: 120, P2: 200, P3: 300, P4: 420 };
const BREACH_PENALTY: Record<Priority, number> = { P1: 10, P2: 7, P3: 5, P4: 3 };

function buildInitial(shift: Shift): State {
  const items: Record<string, ItemRuntime> = {};
  shift.items.forEach((i) => { items[i.id] = { status: "queued", steps: [], attempts: 0, phoneChoice: null, breached: false }; });
  const stock: Record<string, number> = {};
  shift.inventory.forEach((p) => { stock[p.sku] = p.stock; });
  const adStatus: Record<string, string> = {};
  shift.adUsers.forEach((u) => { adStatus[u.username] = u.status; });
  return {
    secondsLeft: shift.durationSeconds,
    ended: false,
    csat: 100,
    fangs: 0,
    xp: 0,
    budget: shift.startingBudget,
    stock,
    adStatus,
    kbRead: [],
    activeApp: "tickets",
    activeItemId: null,
    items,
    feed: [],
    feedSeq: 0,
  };
}

function pushFeed(s: State, text: string, tone: FeedTone): State {
  const seq = s.feedSeq + 1;
  return { ...s, feedSeq: seq, feed: [...s.feed, { seq, text, tone }].slice(-4) };
}

function makeReducer(shift: Shift) {
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
        const breached: string[] = [];
        shift.items.forEach((i) => {
          const it = items[i.id];
          if (it.breached || isTerminal(it.status) || elapsed < i.arriveAfter) return;
          if (elapsed >= i.arriveAfter + SLA_BUDGET[i.priority]) {
            const base = BREACH_PENALTY[i.priority];
            const pen = i.from.vip ? Math.round(base * 1.5) : base;
            items = { ...items, [i.id]: { ...it, breached: true } };
            csat = clamp(csat - pen);
            breached.push(i.subject);
          }
        });
        if (breached.length) {
          ns = { ...ns, items, csat };
          breached.forEach((s) => { ns = pushFeed(ns, `SLA breach: ${s}`, "bad"); });
        }
        if (nextLeft === 0) ns = { ...ns, ended: true };
        return ns;
      }
      case "APP":
        return { ...state, activeApp: a.app, activeItemId: null };
      case "OPEN":
        return { ...state, activeItemId: a.id };
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
        return pushFeed(
          { ...state, budget: state.budget - part.unitCost, stock: { ...state.stock, [a.sku]: (state.stock[a.sku] ?? 0) + 1 } },
          `Ordered 1x ${part.name} from ${part.vendor} for $${part.unitCost}.`, "info",
        );
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
        if (a.correct && !steps.includes("phone")) steps = [...steps, "phone"];
        return { ...state, items: { ...state.items, [a.id]: { ...it, steps, phoneChoice: a.index } } };
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
        let newStatus: ItemStatus = it.status;
        if (correct) newStatus = (action.outcome as ItemStatus) ?? "resolved";
        else if (action.ends) newStatus = (action.outcome as ItemStatus) ?? "mishandled";
        // VIP weighting: they notice great service and remember a botched call.
        let csatDelta = action.csat;
        if (item.from.vip) {
          if (correct) csatDelta += 2;
          else if (action.ends) csatDelta -= 3;
        }
        const csat = clamp(state.csat + csatDelta);
        let ns: State = {
          ...state,
          csat,
          fangs: state.fangs + (correct ? item.reward : 0),
          xp: state.xp + (correct ? item.xp : 0),
          items: { ...state.items, [item.id]: { ...it, status: newStatus, attempts: it.attempts + 1 } },
        };
        ns = pushFeed(ns, action.teach, correct ? "good" : "bad");

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
        const allDone = shift.items.every((i) => isTerminal(ns.items[i.id].status));
        if (allDone) ns = { ...ns, ended: true };
        return ns;
      }
      case "END":
        return { ...state, ended: true };
      default:
        return state;
    }
  };
}

/* ───────────────────────── helpers ───────────────────────── */

const PRIORITY_COLOR: Record<Priority, string> = { P1: "#EF4444", P2: "#F59E0B", P3: "#4A90D9", P4: "#6B7280" };

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: "open", resolved: "resolved", escalated: "escalated", archived: "archived", reported: "reported", mishandled: "mishandled",
};
const STATUS_COLOR: Record<ItemStatus, string> = {
  queued: "#6B7280", resolved: "#2BBE6B", escalated: "#4A90D9", archived: "#6B7280", reported: "#2BBE6B", mishandled: "#EF4444",
};

const GOOD_STATUSES: ItemStatus[] = ["resolved", "escalated", "archived", "reported"];

function computeResult(shift: Shift, state: State): ShiftResult {
  const resolved = shift.items.filter((i) => GOOD_STATUSES.includes(state.items[i.id].status)).length;
  const total = shift.items.length;
  const score = Math.round(state.csat * 0.6 + (resolved / total) * 40);
  const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D";
  return { shiftId: shift.id, score, grade, csat: state.csat, fangs: state.fangs, xp: state.xp, resolved, total };
}

/* ───────────────────────── component ───────────────────────── */

const APPS: { id: AppId; label: string; Icon: typeof Ticket }[] = [
  { id: "tickets", label: "Tickets", Icon: Ticket },
  { id: "inbox", label: "Inbox", Icon: EnvelopeSimple },
  { id: "phone", label: "Phone", Icon: DeviceMobile },
  { id: "inventory", label: "Stockroom", Icon: Package },
  { id: "kb", label: "Knowledge", Icon: BookBookmark },
  { id: "ad", label: "Admin", Icon: IdentificationBadge },
];

export default function LionDesk({ shift, onComplete, onExit, onReplay }: { shift: Shift; onComplete?: (r: ShiftResult) => void; onExit?: () => void; onReplay?: () => void }) {
  const reducer = useMemo(() => makeReducer(shift), [shift]);
  const [state, dispatch] = useReducer(reducer, shift, buildInitial);
  const accent = shift.accent ?? "#4A90D9";
  const completedRef = useRef(false);

  // Only show the apps this shift actually uses (a SOC shift has no stockroom).
  const usedApps = useMemo(() => {
    const s = new Set<AppId>(["tickets"]);
    shift.items.forEach((i) => {
      if (i.channel === "email") s.add("inbox");
      if (i.channel === "phone") s.add("phone");
      if (i.part) s.add("inventory");
      if (i.ad) s.add("ad");
      if (i.kbArticleId) s.add("kb");
    });
    return s;
  }, [shift]);

  // Shift clock.
  useEffect(() => {
    if (state.ended) return;
    const id = setInterval(() => dispatch({ t: "TICK" }), 1000);
    return () => clearInterval(id);
  }, [state.ended]);

  // Fire the completion callback exactly once when the shift ends.
  useEffect(() => {
    if (state.ended && !completedRef.current) {
      completedRef.current = true;
      onComplete?.(computeResult(shift, state));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ended]);

  // ── Sound ──
  const [muted, setMutedState] = useState(false);
  useEffect(() => { setMutedState(isMuted()); }, []);
  // The browser needs a gesture before audio can play; resume on first input.
  useEffect(() => {
    const resume = () => resumeAudio();
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, []);
  const soundPrev = useRef<{ landed: number; resolved: number; breached: number; mishandled: number; ended: boolean } | null>(null);
  useEffect(() => {
    const el = shift.durationSeconds - state.secondsLeft;
    const landedN = shift.items.filter((i) => el >= i.arriveAfter).length;
    const resolvedN = shift.items.filter((i) => GOOD_STATUSES.includes(state.items[i.id].status)).length;
    const breachedN = shift.items.filter((i) => state.items[i.id].breached).length;
    const mishandledN = shift.items.filter((i) => state.items[i.id].status === "mishandled").length;
    const p = soundPrev.current;
    if (p) {
      // Independent checks: a single tick can both land a ticket and breach
      // another, and each cue must fire (an else-if would drop one for good).
      if (breachedN > p.breached) playBreach();
      if (mishandledN > p.mishandled) playFail();
      if (resolvedN > p.resolved) playResolve();
      if (landedN > p.landed) playArrival();
      if (state.ended && !p.ended) playWin();
    }
    soundPrev.current = { landed: landedN, resolved: resolvedN, breached: breachedN, mishandled: mishandledN, ended: state.ended };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) resumeAudio();
  }

  const elapsed = shift.durationSeconds - state.secondsLeft;
  const landed = (i: ShiftItem) => elapsed >= i.arriveAfter;
  const activeItem = state.activeItemId ? shift.items.find((i) => i.id === state.activeItemId) ?? null : null;

  const resolvedCount = shift.items.filter((i) => isTerminal(state.items[i.id].status)).length;

  // unread/open counts per app for dock badges
  const openByApp = (app: AppId): number => {
    const chan = app === "inbox" ? "email" : app === "tickets" ? "ticket" : app === "phone" ? "phone" : null;
    if (!chan) return 0;
    return shift.items.filter((i) => i.channel === chan && landed(i) && !isTerminal(state.items[i.id].status)).length;
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] overflow-hidden bg-[#070b14]">
      <style>{`@keyframes ld-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes ld-toast-life{0%{opacity:0;transform:translateY(8px)}6%{opacity:1;transform:translateY(0)}84%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-6px)}}`}</style>
      <StatusBar shift={shift} state={state} resolved={resolvedCount} total={shift.items.length} onEnd={() => dispatch({ t: "END" })} muted={muted} onToggleMute={toggleMute} />

      <div className="grid grid-cols-[64px_1fr] min-h-[560px]">
        {/* Dock */}
        <div className="border-r border-white/[0.06] bg-white/[0.015] py-3 flex flex-col items-center gap-2">
          {APPS.filter((app) => usedApps.has(app.id)).map(({ id, label, Icon }) => {
            const active = state.activeApp === id && !activeItem;
            const badge = openByApp(id);
            return (
              <button
                key={id}
                onClick={() => dispatch({ t: "APP", app: id })}
                title={label}
                className={`relative w-11 h-11 rounded-xl flex items-center justify-center border transition-colors ${active ? "" : "border-transparent hover:bg-white/[0.05]"}`}
                style={active ? { background: `${accent}26`, borderColor: `${accent}80` } : undefined}
              >
                <Icon size={20} weight={active ? "fill" : "regular"} color={active ? accent : "#9FB2CC"} aria-hidden="true" />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main panel */}
        <div className="relative min-w-0">
          {activeItem ? (
            <WorkView shift={shift} state={state} item={activeItem} dispatch={dispatch} />
          ) : (
            <AppPanel shift={shift} state={state} dispatch={dispatch} landed={landed} />
          )}
          <Toasts feed={state.feed} />
        </div>
      </div>

      {state.ended && <ShiftReport shift={shift} state={state} onReplay={onReplay} onExit={onExit} />}
    </div>
  );
}

/* ───────────────────────── status bar ───────────────────────── */

function StatusBar({ shift, state, resolved, total, onEnd, muted, onToggleMute }: { shift: Shift; state: State; resolved: number; total: number; onEnd: () => void; muted: boolean; onToggleMute: () => void }) {
  const csatColor = state.csat >= 80 ? "#2BBE6B" : state.csat >= 55 ? "#F59E0B" : "#EF4444";
  const low = state.secondsLeft <= 60;
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02] flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <Lightning size={16} weight="fill" color="#FFD700" aria-hidden="true" />
        <span className="font-bebas text-sm text-cream tracking-wide truncate">{shift.name}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/40 hidden sm:inline">· {shift.rank}</span>
      </div>
      <div className="ml-auto flex items-center gap-4 font-mono text-[11px]">
        <span className="flex items-center gap-1.5" style={{ color: low ? "#EF4444" : "#9FB2CC" }}>
          <Clock size={13} weight="bold" aria-hidden="true" /> {fmt(state.secondsLeft)}
        </span>
        <span className="flex items-center gap-1.5" title="User satisfaction">
          <span className="text-cream/45">CSAT</span>
          <span className="w-16 h-1.5 rounded-full overflow-hidden bg-white/10 hidden sm:inline-block align-middle">
            <span className="block h-full" style={{ width: `${state.csat}%`, background: csatColor }} />
          </span>
          <span style={{ color: csatColor }}>{state.csat}%</span>
        </span>
        <span className="text-gold tabular-nums">{state.fangs} Fangs</span>
        <span className="text-cream/55 tabular-nums">{resolved}/{total}</span>
        <button onClick={onToggleMute} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute sounds" : "Mute sounds"} className="w-7 h-7 rounded-md border border-white/15 text-cream/60 hover:bg-white/[0.06] hover:text-cream transition-colors flex items-center justify-center">
          {muted ? <SpeakerSlash size={13} weight="fill" aria-hidden="true" /> : <SpeakerHigh size={13} weight="fill" aria-hidden="true" />}
        </button>
        <button onClick={onEnd} className="px-2.5 py-1 rounded-md border border-white/15 text-cream/70 hover:bg-white/[0.06] hover:text-cream transition-colors uppercase tracking-wider text-[10px]">
          End shift
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── app panels ───────────────────────── */

function AppPanel({ shift, state, dispatch, landed }: { shift: Shift; state: State; dispatch: Dispatch<Action>; landed: (i: ShiftItem) => boolean }) {
  switch (state.activeApp) {
    case "inbox": return <ChannelList shift={shift} state={state} dispatch={dispatch} landed={landed} channel="email" empty="Inbox zero. Nice." />;
    case "tickets": return <ChannelList shift={shift} state={state} dispatch={dispatch} landed={landed} channel="ticket" empty="No open tickets." />;
    case "phone": return <ChannelList shift={shift} state={state} dispatch={dispatch} landed={landed} channel="phone" empty="No texts right now." />;
    case "inventory": return <InventoryApp shift={shift} state={state} dispatch={dispatch} />;
    case "kb": return <KbApp shift={shift} state={state} dispatch={dispatch} />;
    case "ad": return <AdApp shift={shift} state={state} dispatch={dispatch} />;
    default: return null;
  }
}

function ChannelList({ shift, state, dispatch, landed, channel, empty }: { shift: Shift; state: State; dispatch: Dispatch<Action>; landed: (i: ShiftItem) => boolean; channel: ShiftItem["channel"]; empty: string }) {
  const rows = shift.items.filter((i) => i.channel === channel && landed(i));
  const elapsed = shift.durationSeconds - state.secondsLeft;
  return (
    <div className="p-4 max-h-[560px] overflow-y-auto">
      {rows.length === 0 ? (
        <div className="text-center text-cream/45 text-sm py-16">{empty}</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((i) => {
            const st = state.items[i.id];
            const done = isTerminal(st.status);
            const remaining = i.arriveAfter + SLA_BUDGET[i.priority] - elapsed;
            return (
              <li key={i.id}>
                <button onClick={() => dispatch({ t: "OPEN", id: i.id })} className={`w-full text-left rounded-xl border p-3 transition-colors ${done ? "opacity-60" : "hover:bg-white/[0.04]"}`} style={{ borderColor: "rgba(255,255,255,0.08)", background: done ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.025)", animation: "ld-toast-in 240ms ease-out" }}>
                  <div className="flex items-center gap-2">
                    {channel === "ticket" && (
                      <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: PRIORITY_COLOR[i.priority], background: `${PRIORITY_COLOR[i.priority]}1f`, border: `1px solid ${PRIORITY_COLOR[i.priority]}40` }}>{i.priority}</span>
                    )}
                    <span className="text-cream text-sm font-semibold truncate">{i.subject}</span>
                    {i.from.vip && <span className="font-mono text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-gold/15 text-gold border border-gold/30">VIP</span>}
                    {done ? (
                      <span className="ml-auto font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: STATUS_COLOR[st.status], background: `${STATUS_COLOR[st.status]}1f` }}>{STATUS_LABEL[st.status]}</span>
                    ) : st.breached ? (
                      <span className="ml-auto font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/40">breached</span>
                    ) : (
                      <span className="ml-auto font-mono text-[9px] tabular-nums" style={{ color: remaining <= 30 ? "#EF4444" : "rgba(238,244,255,0.4)" }} title={`SLA ${i.slaMinutes}m`}>{fmt(Math.max(0, remaining))}</span>
                    )}
                  </div>
                  <p className="text-cream/55 text-[11px] mt-1 truncate">
                    {i.from.name} · {i.from.role}
                    {channel === "phone" && i.phone ? ` — "${i.phone.opener.slice(0, 60)}..."` : ""}
                    {channel === "email" && i.email ? ` — ${i.email.body.slice(0, 60)}...` : ""}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function InventoryApp({ shift, state, dispatch }: { shift: Shift; state: State; dispatch: Dispatch<Action> }) {
  return (
    <div className="p-4 max-h-[560px] overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bebas text-lg text-cream tracking-wide">Stockroom</h3>
        <span className="font-mono text-xs text-cream/60">Budget <span className="text-gold tabular-nums">${state.budget.toLocaleString()}</span></span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-cream/40 font-mono text-[10px] uppercase tracking-wider text-left">
            <th className="pb-2">Item</th><th className="pb-2">Vendor</th><th className="pb-2 text-right">Stock</th><th className="pb-2 text-right">Cost</th><th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {shift.inventory.map((p) => {
            const stock = state.stock[p.sku] ?? 0;
            return (
              <tr key={p.sku} className="border-t border-white/[0.05]">
                <td className="py-2.5 text-cream">{p.name}</td>
                <td className="py-2.5 text-cream/55 text-xs">{p.vendor}</td>
                <td className="py-2.5 text-right tabular-nums" style={{ color: stock === 0 ? "#EF4444" : "#9FB2CC" }}>{stock}</td>
                <td className="py-2.5 text-right text-cream/60 tabular-nums">${p.unitCost}</td>
                <td className="py-2.5 text-right">
                  <button onClick={() => dispatch({ t: "ORDER", sku: p.sku })} className="px-2.5 py-1 rounded-md border border-electric/40 text-electric text-[11px] hover:bg-electric/10 transition-colors">Order</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="font-mono text-[10px] text-cream/35 mt-3">Order parts to restock. To send a part to a user, open their ticket and ship it from there.</p>
    </div>
  );
}

function KbApp({ shift, state, dispatch }: { shift: Shift; state: State; dispatch: Dispatch<Action> }) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const results = shift.kb.filter((a) => {
    const t = (q || "").toLowerCase();
    return !t || a.title.toLowerCase().includes(t) || a.tags.some((tag) => tag.includes(t));
  });
  const open = openId ? shift.kb.find((a) => a.id === openId) ?? null : null;

  if (open) {
    return (
      <div className="p-4 max-h-[560px] overflow-y-auto">
        <button onClick={() => setOpenId(null)} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-cream/55 hover:text-electric mb-3"><ArrowLeft size={13} /> all articles</button>
        <h3 className="font-bebas text-xl text-cream tracking-wide">{open.title}</h3>
        <div className="flex gap-1.5 mt-1 mb-3 flex-wrap">{open.tags.map((t) => <span key={t} className="font-mono text-[9px] text-electric/70 px-1.5 py-0.5 rounded bg-electric/10">#{t}</span>)}</div>
        <div className="space-y-2.5">{open.body.map((p, i) => <p key={i} className="text-cream/80 text-sm leading-relaxed">{p}</p>)}</div>
        {state.kbRead.includes(open.id) && <p className="mt-3 font-mono text-[10px] text-[#2BBE6B]">✓ read</p>}
      </div>
    );
  }

  return (
    <div className="p-4 max-h-[560px] overflow-y-auto">
      <h3 className="font-bebas text-lg text-cream tracking-wide mb-2">Knowledge Base</h3>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 mb-3">
        <MagnifyingGlass size={14} color="#9FB2CC" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search the KB..." className="bg-transparent text-sm text-cream placeholder:text-cream/30 focus:outline-none flex-1" />
      </div>
      <ul className="space-y-2">
        {results.map((a) => (
          <li key={a.id}>
            <button onClick={() => { setOpenId(a.id); dispatch({ t: "KB", articleId: a.id }); }} className="w-full text-left rounded-lg border border-white/[0.07] p-3 hover:bg-white/[0.04] transition-colors">
              <div className="flex items-center gap-2">
                <BookBookmark size={15} color="#FFD700" aria-hidden="true" />
                <span className="text-cream text-sm font-semibold">{a.title}</span>
                {state.kbRead.includes(a.id) && <CheckCircle size={13} weight="fill" color="#2BBE6B" className="ml-auto" />}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdApp({ shift, state, dispatch }: { shift: Shift; state: State; dispatch: Dispatch<Action> }) {
  const statusColor: Record<string, string> = { active: "#2BBE6B", locked: "#EF4444", reset_required: "#F59E0B" };
  return (
    <div className="p-4 max-h-[560px] overflow-y-auto">
      <h3 className="font-bebas text-lg text-cream tracking-wide mb-3">Active Directory</h3>
      <ul className="space-y-2">
        {shift.adUsers.map((u) => {
          const st = state.adStatus[u.username];
          return (
            <li key={u.username} className="rounded-lg border border-white/[0.07] p-3">
              <div className="flex items-center gap-2">
                <IdentificationBadge size={16} color="#9FB2CC" aria-hidden="true" />
                <span className="text-cream text-sm font-semibold">{u.name}</span>
                <span className="font-mono text-[10px] text-cream/40">{u.username} · {u.group}</span>
                <span className="ml-auto font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: statusColor[st] ?? "#9FB2CC", background: `${statusColor[st] ?? "#9FB2CC"}1f` }}>{st.replace("_", " ")}</span>
              </div>
              <div className="flex gap-2 mt-2.5">
                <button onClick={() => dispatch({ t: "AD", username: u.username, action: "unlock" })} className="px-2 py-1 rounded-md border border-white/15 text-cream/70 text-[11px] hover:bg-white/[0.06]">Unlock</button>
                <button onClick={() => dispatch({ t: "AD", username: u.username, action: "reset_pw" })} className="px-2 py-1 rounded-md border border-white/15 text-cream/70 text-[11px] hover:bg-white/[0.06]">Reset password</button>
                <button onClick={() => dispatch({ t: "AD", username: u.username, action: "reset_mfa" })} className="px-2 py-1 rounded-md border border-white/15 text-cream/70 text-[11px] hover:bg-white/[0.06]">Reset MFA</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ───────────────────────── work view ───────────────────────── */

function WorkView({ shift, state, item, dispatch }: { shift: Shift; state: State; item: ShiftItem; dispatch: Dispatch<Action> }) {
  const it = state.items[item.id];
  const [showHint, setShowHint] = useState(false);
  const elapsed = shift.durationSeconds - state.secondsLeft;
  const slaRemaining = item.arriveAfter + SLA_BUDGET[item.priority] - elapsed;
  const kbArticle = item.kbArticleId ? shift.kb.find((a) => a.id === item.kbArticleId) ?? null : null;
  const part = item.part ? shift.inventory.find((p) => p.sku === item.part!.sku) ?? null : null;
  const stepDone = (k: string) => (k === "kb" ? state.kbRead.includes(item.kbArticleId ?? "") : it.steps.includes(k));

  return (
    <div className="p-4 max-h-[560px] overflow-y-auto">
      <button onClick={() => dispatch({ t: "CLOSE" })} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-cream/55 hover:text-electric mb-3"><ArrowLeft size={13} /> back to queue</button>

      {/* header */}
      <div className="flex items-center gap-2 mb-1">
        {item.channel === "ticket" && <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: PRIORITY_COLOR[item.priority], background: `${PRIORITY_COLOR[item.priority]}1f`, border: `1px solid ${PRIORITY_COLOR[item.priority]}40` }}>{item.priority}</span>}
        <span className="font-mono text-[9px] uppercase tracking-wider text-cream/40">{item.channel} · SLA {item.slaMinutes}m</span>
        {!isTerminal(it.status) && (it.breached ? (
          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/40">breached</span>
        ) : (
          <span className="font-mono text-[9px] tabular-nums px-1.5 py-0.5 rounded" style={{ color: slaRemaining <= 30 ? "#EF4444" : "#9FB2CC", background: "rgba(255,255,255,0.04)" }}>{fmt(Math.max(0, slaRemaining))}</span>
        ))}
        {item.from.vip && <span className="font-mono text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-gold/15 text-gold border border-gold/30">VIP</span>}
      </div>
      <h2 className="font-bebas text-2xl text-cream tracking-wide leading-tight">{item.subject}</h2>
      <p className="text-cream/50 text-xs mt-0.5">{item.from.name} · {item.from.role}{item.asset ? ` · ${item.asset}` : ""}</p>

      {/* content */}
      {item.channel === "phone" && item.phone ? (
        <PhoneThread item={item} runtime={it} dispatch={dispatch} />
      ) : (
        <p className="text-cream/85 text-sm leading-relaxed mt-3 rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 whitespace-pre-wrap">
          {item.email?.body ?? item.ticketBody}
        </p>
      )}

      {/* evidence */}
      {item.evidence && item.evidence.map((ev) => (
        <div key={ev.label} className="mt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-electric/70 mb-1">{ev.label}</p>
          <pre className="text-[11px] leading-relaxed text-cream/70 font-mono bg-black/30 border border-white/[0.06] rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">{ev.lines.join("\n")}</pre>
        </div>
      ))}

      {/* tools */}
      <div className="mt-4 space-y-3">
        {item.commands && <MiniTerminal item={item} onStep={(s) => dispatch({ t: "STEP", id: item.id, step: s })} />}

        {part && (
          <ToolBox label="Stockroom" done={stepDone("part")}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-cream/75">{part.name} · in stock: <span style={{ color: (state.stock[part.sku] ?? 0) > 0 ? "#2BBE6B" : "#EF4444" }}>{state.stock[part.sku] ?? 0}</span></span>
              <span className="flex gap-2">
                {(state.stock[part.sku] ?? 0) <= 0 && <button onClick={() => dispatch({ t: "ORDER", sku: part.sku })} className="px-2.5 py-1 rounded-md border border-electric/40 text-electric hover:bg-electric/10">Order (${part.unitCost})</button>}
                <button disabled={(state.stock[part.sku] ?? 0) <= 0} onClick={() => dispatch({ t: "SHIP", sku: part.sku })} className="px-2.5 py-1 rounded-md border border-white/15 text-cream/70 hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed">Ship to user</button>
              </span>
            </div>
          </ToolBox>
        )}

        {item.ad && (
          <ToolBox label="Admin console" done={stepDone("ad")}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-cream/75">{item.ad.username} · status: <span style={{ color: state.adStatus[item.ad.username] === "active" ? "#2BBE6B" : "#EF4444" }}>{(state.adStatus[item.ad.username] ?? "").replace("_", " ")}</span></span>
              <button onClick={() => dispatch({ t: "AD", username: item.ad!.username, action: item.ad!.action })} className="px-2.5 py-1 rounded-md border border-white/15 text-cream/70 hover:bg-white/[0.06] capitalize">{item.ad.action.replace("_", " ")}</button>
            </div>
          </ToolBox>
        )}

        {kbArticle && (
          <ToolBox label="Knowledge base" done={stepDone("kb")}>
            <KbInline article={kbArticle} read={state.kbRead.includes(kbArticle.id)} onRead={() => dispatch({ t: "KB", articleId: kbArticle.id })} />
          </ToolBox>
        )}
      </div>

      {/* hint */}
      <div className="mt-3">
        {showHint ? (
          <p className="text-cream/65 text-xs rounded-lg border border-gold/20 bg-gold/[0.05] p-2.5">💡 {item.hint}</p>
        ) : (
          <button onClick={() => setShowHint(true)} className="font-mono text-[11px] text-cream/45 hover:text-gold">need a hint?</button>
        )}
      </div>

      {/* actions */}
      {!isTerminal(it.status) ? (
        <div className="mt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-2">Choose your move · {item.goal}</p>
          <div className="grid gap-2">
            {item.actions.map((act) => (
              <button key={act.id} onClick={() => dispatch({ t: "RESOLVE", id: item.id, actionId: act.id })} className="text-left rounded-xl border border-white/[0.1] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/25 transition-colors p-3">
                <span className="text-cream text-sm">{act.label}</span>
                {act.detail && <span className="block font-mono text-[11px] text-cream/50 mt-0.5">{act.detail}</span>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl p-3 border" style={{ borderColor: `${STATUS_COLOR[it.status]}55`, background: `${STATUS_COLOR[it.status]}12` }}>
          <p className="font-bebas text-lg tracking-wide" style={{ color: STATUS_COLOR[it.status] }}>{STATUS_LABEL[it.status].toUpperCase()}</p>
          <p className="text-cream/70 text-xs mt-1">Pick the next item from the dock.</p>
        </div>
      )}
    </div>
  );
}

function ToolBox({ label, done, children }: { label: string; done: boolean; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/45">{label}</span>
        {done && <CheckCircle size={12} weight="fill" color="#2BBE6B" />}
      </div>
      {children}
    </div>
  );
}

function KbInline({ article, read, onRead }: { article: { id: string; title: string; body: string[] }; read: boolean; onRead: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button onClick={() => { setOpen((o) => !o); if (!read) onRead(); }} className="text-electric hover:underline">
        {open ? "Hide" : "Look it up:"} {article.title}
      </button>
      {open && <div className="mt-2 space-y-1.5">{article.body.map((p, i) => <p key={i} className="text-cream/75 leading-relaxed">{p}</p>)}</div>}
    </div>
  );
}

function PhoneThread({ item, runtime, dispatch }: { item: ShiftItem; runtime: ItemRuntime; dispatch: Dispatch<Action> }) {
  const fu = item.phone!.followups;
  const chosen = runtime.phoneChoice;
  return (
    <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="space-y-2">
        <Bubble who="user" text={item.phone!.opener} />
        {chosen !== null && <Bubble who="you" text={fu[chosen].label} />}
        {chosen !== null && <Bubble who="user" text={fu[chosen].reply} />}
      </div>
      {!runtime.steps.includes("phone") && (
        <div className="mt-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/45 mb-1.5">Text back:</p>
          <div className="grid gap-1.5">
            {fu.map((f, i) => (
              <button key={i} onClick={() => dispatch({ t: "PHONE", id: item.id, index: i, correct: !!f.correct })} className="text-left text-xs rounded-lg border border-white/[0.1] px-2.5 py-1.5 text-cream/85 hover:bg-white/[0.05]">{f.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ who, text }: { who: "user" | "you"; text: string }) {
  const mine = who === "you";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <span className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-xs ${mine ? "bg-electric/20 text-cream rounded-br-sm" : "bg-white/[0.06] text-cream/85 rounded-bl-sm"}`}>{text}</span>
    </div>
  );
}

function MiniTerminal({ item, onStep }: { item: ShiftItem; onStep: (step: string) => void }) {
  const [lines, setLines] = useState<{ tone: "in" | "out"; text: string }[]>([{ tone: "out", text: "Investigate. Try: " + item.commands!.map((c) => c.aliases[0]).join(", ") }]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [lines]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd) return;
    const norm = cmd.toLowerCase();
    const match = item.commands!.find((c) => c.aliases.some((al) => norm === al || norm.startsWith(al + " ")));
    setLines((prev) => [...prev, { tone: "in", text: `$ ${cmd}` }, { tone: "out", text: match ? match.output : `command not found: ${cmd}` }]);
    if (match?.step) onStep(match.step);
    setInput("");
  }

  return (
    <ToolBox label="Terminal" done={false}>
      <div ref={scrollRef} className="max-h-32 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-0.5 mb-2">
        {lines.map((l, i) => <div key={i} className={l.tone === "in" ? "text-electric" : "text-cream/75 whitespace-pre-wrap"}>{l.text}</div>)}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-electric">$</span>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="run a command..." spellCheck={false} className="flex-1 bg-transparent font-mono text-[11px] text-cream placeholder:text-cream/25 focus:outline-none" />
      </form>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {item.commands!.map((c) => (
          <button key={c.aliases[0]} type="button" onClick={() => { const match = c; setLines((prev) => [...prev, { tone: "in", text: `$ ${c.aliases[0]}` }, { tone: "out", text: c.output }]); if (match.step) onStep(match.step); }} className="font-mono text-[10px] px-2 py-0.5 rounded border border-white/12 text-cream/60 hover:bg-white/[0.06]">{c.aliases[0]}</button>
        ))}
      </div>
    </ToolBox>
  );
}

/* ───────────────────────── toasts ───────────────────────── */

// Self-managing toasts: each one auto-dismisses ~4.2s after it appears, and at
// most 3 are on screen at once (a 4th pushes the oldest out immediately). This
// stops the teaching notifications from stacking up and sitting on the screen.
function Toasts({ feed }: { feed: FeedEntry[] }) {
  const [visible, setVisible] = useState<FeedEntry[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const timers = useRef<number[]>([]);

  useEffect(() => {
    for (const f of feed) {
      if (seen.current.has(f.seq)) continue;
      seen.current.add(f.seq);
      setVisible((cur) => [...cur, f].slice(-3));
      const id = window.setTimeout(() => setVisible((cur) => cur.filter((x) => x.seq !== f.seq)), 4200);
      timers.current.push(id);
    }
  }, [feed]);

  useEffect(() => () => { timers.current.forEach((id) => clearTimeout(id)); }, []);

  if (visible.length === 0) return null;
  const color = (t: FeedTone) => (t === "good" ? "#2BBE6B" : t === "bad" ? "#EF4444" : "#4A90D9");
  return (
    <div className="absolute bottom-3 right-3 left-3 sm:left-auto sm:w-80 space-y-2 pointer-events-none z-30">
      {visible.map((f) => (
        <div key={f.seq} className="rounded-lg border bg-[#0a0f1c]/95 backdrop-blur px-3 py-2 text-xs leading-snug shadow-lg" style={{ borderColor: `${color(f.tone)}55`, color: "#E7EEFA", animation: "ld-toast-life 4200ms ease-out forwards" }}>
          <span style={{ color: color(f.tone) }}>{f.tone === "good" ? "✓ " : f.tone === "bad" ? "✕ " : "› "}</span>{f.text}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── shift report ───────────────────────── */

function ShiftReport({ shift, state, onReplay, onExit }: { shift: Shift; state: State; onReplay?: () => void; onExit?: () => void }) {
  const resolved = shift.items.filter((i) => ["resolved", "escalated", "archived", "reported"].includes(state.items[i.id].status));
  const fumbled = shift.items.filter((i) => state.items[i.id].status === "mishandled");
  const open = shift.items.filter((i) => state.items[i.id].status === "queued");
  const breaches = shift.items.filter((i) => state.items[i.id].breached).length;
  const { score, grade } = computeResult(shift, state);
  const gradeColor = grade === "S" || grade === "A" ? "#2BBE6B" : grade === "B" ? "#4A90D9" : grade === "C" ? "#F59E0B" : "#EF4444";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#0a0f1c] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <Trophy size={28} weight="fill" color={gradeColor} aria-hidden="true" />
          <div>
            <h3 className="font-bebas text-2xl text-cream tracking-wide leading-none">Shift complete</h3>
            <p className="text-cream/50 text-xs mt-0.5">{shift.name}</p>
          </div>
          <span className="ml-auto font-bebas text-4xl leading-none" style={{ color: gradeColor }}>{grade}</span>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { label: "resolved", value: `${resolved.length}/${shift.items.length}`, color: "#2BBE6B" },
            { label: "CSAT", value: `${state.csat}%`, color: "#4A90D9" },
            { label: "Fangs", value: `${state.fangs}`, color: "#FFD700" },
            { label: "XP", value: `${state.xp}`, color: "#A855F7" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-white/[0.07] p-2.5 text-center">
              <p className="font-bebas text-xl tabular-nums leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {fumbled.length > 0 && (
          <div className="mb-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-red-400 mb-1.5">Mishandled</p>
            <ul className="space-y-1">{fumbled.map((i) => <li key={i.id} className="text-cream/70 text-xs">✕ {i.subject}</li>)}</ul>
          </div>
        )}
        {open.length > 0 && (
          <div className="mb-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-cream/45 mb-1.5">Left open (time ran out)</p>
            <ul className="space-y-1">{open.map((i) => <li key={i.id} className="text-cream/60 text-xs">· {i.subject}</li>)}</ul>
          </div>
        )}

        {breaches > 0 && (
          <p className="font-mono text-[10px] text-red-400/80 mb-3">{breaches} ticket{breaches === 1 ? "" : "s"} breached SLA. Triage the high-priority queue faster next shift.</p>
        )}

        <p className="font-mono text-[10px] text-cream/35 leading-relaxed mb-4">
          Fangs and XP are a preview. They are granted for real once a shift is validated server-side, so the economy stays tamper-proof.
        </p>

        <div className="flex gap-2">
          <button onClick={() => (onReplay ? onReplay() : window.location.reload())} className="flex-1 min-h-[44px] rounded-xl font-bold text-sm text-[#04080F] flex items-center justify-center gap-2" style={{ background: "linear-gradient(135deg,#FFD700,#FFA500)" }}>
            <ArrowClockwise size={16} weight="bold" /> Run it back
          </button>
          {onExit ? (
            <button onClick={onExit} className="flex-1 min-h-[44px] rounded-xl border border-white/15 text-cream/80 text-sm font-semibold flex items-center justify-center hover:bg-white/[0.05]">Back to campaign</button>
          ) : (
            <Link href={`/learn/techhub/${shift.track}`} className="flex-1 min-h-[44px] rounded-xl border border-white/15 text-cream/80 text-sm font-semibold flex items-center justify-center hover:bg-white/[0.05]">Back to track</Link>
          )}
        </div>
      </div>
    </div>
  );
}
