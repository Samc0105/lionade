"use client";

import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type Dispatch, type ReactNode } from "react";
import {
  EnvelopeSimple, Ticket, DeviceMobile, Package, BookBookmark, IdentificationBadge,
  Clock, CheckCircle, ArrowLeft, MagnifyingGlass, Lightning, Trophy, ArrowClockwise,
  SpeakerHigh, SpeakerSlash, X,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { AppId, ShiftItem, Shift, Priority } from "@/lib/liondesk/types";
import { playArrival, playResolve, playBreach, playFail, playWin, playClockIn, playDelivery, playStreak, resumeAudio, isMuted, setMuted } from "@/lib/liondesk/sound";
import { getEquippedTheme, type DeskTheme } from "@/lib/liondesk/themes";
import { managerReviewFor } from "@/lib/liondesk/managerReview";

import {
  type ShiftResult, type State, type Action, type ItemRuntime, type ItemStatus,
  type Difficulty, type FeedEntry, type FeedTone,
  DIFF, GOOD_STATUSES,
  isTerminal, isLive, slaBudget, leadFor, buildInitial, makeReducer, computeResult,
} from "@/lib/liondesk/engine";

// The game logic (reducer, SLA/patience/streak math, scoring, all the state
// types and tuning constants) now lives in @/lib/liondesk/engine — a pure,
// framework-free module that can be unit-tested without React. This file keeps
// only the React components + effects. ShiftResult is re-exported so existing
// importers (components/liondesk/Campaign.tsx, lib/liondesk/stats.ts) keep
// importing it from here unchanged.
export type { ShiftResult };

/* ───────────────────────── view helpers ───────────────────────── */

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

/* ───────────────────────── component ───────────────────────── */

const APPS: { id: AppId; label: string; Icon: typeof Ticket }[] = [
  { id: "tickets", label: "Tickets", Icon: Ticket },
  { id: "inbox", label: "Inbox", Icon: EnvelopeSimple },
  { id: "phone", label: "Phone", Icon: DeviceMobile },
  { id: "inventory", label: "Stockroom", Icon: Package },
  { id: "kb", label: "Knowledge", Icon: BookBookmark },
  { id: "ad", label: "Admin", Icon: IdentificationBadge },
];

export default function LionDesk({ shift, onComplete, onExit, onReplay, bankedFangs, bankPending }: { shift: Shift; onComplete?: (r: ShiftResult) => void; onExit?: () => void; onReplay?: () => void; bankedFangs?: number | null; bankPending?: boolean }) {
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

  // Shift clock. Held until you clock in, so the briefing isn't a ticking clock.
  useEffect(() => {
    if (!state.started || state.ended) return;
    const id = setInterval(() => dispatch({ t: "TICK" }), 1000);
    return () => clearInterval(id);
  }, [state.started, state.ended]);

  // Fire the completion callback exactly once when the shift ends.
  useEffect(() => {
    if (state.ended && !completedRef.current) {
      completedRef.current = true;
      onComplete?.(computeResult(shift, state));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ended]);

  // Keyboard shortcuts: number keys switch apps, Esc closes a ticket. Ignored
  // while typing in the terminal or a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "Escape" && state.activeItemId) { dispatch({ t: "CLOSE" }); return; }
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1) {
        const app = APPS.filter((a) => usedApps.has(a.id))[n - 1];
        if (app) dispatch({ t: "APP", app: app.id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.activeItemId, usedApps]);

  // ── Sound + theme ──
  const [muted, setMutedState] = useState(false);
  const [theme, setTheme] = useState<DeskTheme | null>(null);
  useEffect(() => { setMutedState(isMuted()); setTheme(getEquippedTheme()); }, []);
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
  const soundPrev = useRef<{ landed: number; resolved: number; breached: number; mishandled: number; ended: boolean; stockSum: number; streak: number; started: boolean } | null>(null);
  useEffect(() => {
    const el = shift.durationSeconds - state.secondsLeft;
    const landedN = shift.items.filter((i) => el >= i.arriveAfter && isLive(i, state.items)).length;
    const resolvedN = shift.items.filter((i) => GOOD_STATUSES.includes(state.items[i.id].status)).length;
    const breachedN = shift.items.filter((i) => state.items[i.id].breached).length;
    const mishandledN = shift.items.filter((i) => state.items[i.id].status === "mishandled").length;
    const stockSum = Object.values(state.stock).reduce((a, b) => a + b, 0);
    const p = soundPrev.current;
    if (p) {
      // Independent checks: a single tick can both land a ticket and breach
      // another, and each cue must fire (an else-if would drop one for good).
      if (breachedN > p.breached) playBreach();
      if (mishandledN > p.mishandled) playFail();
      if (resolvedN > p.resolved) playResolve();
      if (landedN > p.landed) playArrival();
      if (stockSum > p.stockSum) playDelivery(); // stock only ever rises on a delivery
      if (state.streak > p.streak && [3, 5, 8, 12].includes(state.streak)) playStreak();
      if (state.started && !p.started) playClockIn();
      if (state.ended && !p.ended) playWin();
    }
    soundPrev.current = { landed: landedN, resolved: resolvedN, breached: breachedN, mishandled: mishandledN, ended: state.ended, stockSum, streak: state.streak, started: state.started };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) resumeAudio();
  }

  // Coworker chatter: teammates react to how the shift is going. Each line fires
  // once (deduped via the ref) so the office feels alive without spamming.
  const coworkerFired = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!state.started || state.ended) return;
    const fire = (key: string, text: string) => {
      if (coworkerFired.current.has(key)) return;
      coworkerFired.current.add(key);
      dispatch({ t: "PING", text });
    };
    const el = shift.durationSeconds - state.secondsLeft;
    const mish = shift.items.filter((i) => state.items[i.id].status === "mishandled").length;
    const breached = shift.items.filter((i) => state.items[i.id].breached).length;
    const resolvedN = shift.items.filter((i) => GOOD_STATUSES.includes(state.items[i.id].status)).length;
    if (el >= 6) fire("hello", "Nadia (next desk): morning. Queue's been busy, yell if you need a hand.");
    if (resolvedN >= 3) fire("rolling", "Dev (teammate): you're carrying the board today. Nice pace.");
    if (state.csat < 60) fire("low-csat", "Nadia: rough patch, shake it off. One ticket at a time.");
    if (breached >= 1) fire("breach", "Dev: don't sweat the SLA. Triage the top of the queue and keep moving.");
    if (mish >= 1) fire("mish", "Nadia: one got away. Happens to all of us. Next one.");
    if (el >= shift.durationSeconds / 2) fire("halfway", "Dev: halfway in and holding. Strong work.");
    if (state.secondsLeft <= 30 && state.secondsLeft > 0) fire("almost", "Nadia: end of shift coming up. Strong finish.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const elapsed = shift.durationSeconds - state.secondsLeft;
  const landed = (i: ShiftItem) => elapsed >= i.arriveAfter && isLive(i, state.items);
  const activeItem = state.activeItemId ? shift.items.find((i) => i.id === state.activeItemId) ?? null : null;

  const liveItems = shift.items.filter((i) => isLive(i, state.items));
  const resolvedCount = liveItems.filter((i) => isTerminal(state.items[i.id].status)).length;

  // unread/open counts per app for dock badges
  const openByApp = (app: AppId): number => {
    const chan = app === "inbox" ? "email" : app === "tickets" ? "ticket" : app === "phone" ? "phone" : null;
    if (!chan) return 0;
    return shift.items.filter((i) => i.channel === chan && landed(i) && !isTerminal(state.items[i.id].status)).length;
  };

  return (
    <div className="ld-motion-scope relative rounded-2xl border border-white/[0.08] overflow-hidden" style={{ backgroundColor: shift.graveyard ? "#04060c" : (theme?.bg ?? "#070b14"), backgroundImage: (theme?.scanlines || shift.graveyard) ? "repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px)" : undefined }}>
      <style>{`@keyframes ld-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes ld-toast-life{0%{opacity:0;transform:translateY(8px)}6%{opacity:1;transform:translateY(0)}84%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-6px)}}`}</style>
      <StatusBar shift={shift} state={state} resolved={resolvedCount} total={liveItems.length} onEnd={() => dispatch({ t: "END" })} muted={muted} onToggleMute={toggleMute} />

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

      {!state.started && <ClockIn shift={shift} usedApps={usedApps} onStart={(d) => dispatch({ t: "START", difficulty: d })} />}
      {state.ended && <ShiftReport shift={shift} state={state} onReplay={onReplay} onExit={onExit} bankedFangs={bankedFangs} bankPending={bankPending} />}
    </div>
  );
}

/* ───────────────────────── clock-in briefing ───────────────────────── */

function ClockIn({ shift, usedApps, onStart }: { shift: Shift; usedApps: Set<AppId>; onStart: (d: Difficulty) => void }) {
  const accent = shift.accent ?? "#4A90D9";
  const [diff, setDiff] = useState<Difficulty>("normal");
  const surfaces = [
    usedApps.has("tickets") && "Tickets",
    usedApps.has("inbox") && "Inbox",
    usedApps.has("phone") && "Phone calls",
    usedApps.has("inventory") && "Stockroom",
    usedApps.has("kb") && "Knowledge base",
    usedApps.has("ad") && "Admin console",
  ].filter(Boolean) as string[];
  const tips = [
    "Highest priority first. P1 tickets breach fast and a breached VIP escalates to your manager.",
    `You get ${DIFF[diff].attempts} tr${DIFF[diff].attempts === 1 ? "y" : "ies"} per item. Run out and it is marked mishandled, so read the evidence before you commit.`,
    usedApps.has("phone") && "On a call, ask the right question to pin the issue before patience runs out, or they hang up.",
    usedApps.has("inventory") && "Parts take time to arrive. Order early or the SLA beats the delivery.",
    "Stuck? Spend a lifeline: Coffee resets a call, Ask a senior reveals the right move.",
  ].filter(Boolean) as string[];
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border bg-[#0a0f1c] p-6 max-h-[92%] overflow-y-auto" style={{ borderColor: `${accent}55` }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: accent }}>{shift.rank} · clocking in</p>
        <h3 className="font-bebas text-3xl text-cream tracking-wide leading-none mt-1">{shift.name}</h3>

        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="rounded-lg border border-white/[0.08] p-2.5 text-center">
            <p className="font-bebas text-xl text-cream tabular-nums leading-none">{fmt(shift.durationSeconds)}</p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45 mt-1">on the clock</p>
          </div>
          <div className="rounded-lg border border-white/[0.08] p-2.5 text-center">
            <p className="font-bebas text-xl text-cream tabular-nums leading-none">{shift.items.length}</p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45 mt-1">items inbound</p>
          </div>
        </div>

        {shift.modifiers && shift.modifiers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {shift.modifiers.map((m) => (
              <span key={m.id} title={m.desc} className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-purple-400/40 text-purple-300 bg-purple-400/10">{m.label}</span>
            ))}
          </div>
        )}

        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/40 mt-4 mb-1.5">On this desk</p>
        <div className="flex flex-wrap gap-1.5">
          {surfaces.map((s) => <span key={s} className="text-[11px] px-2 py-0.5 rounded-md border border-white/10 text-cream/70">{s}</span>)}
        </div>

        <ul className="mt-4 space-y-1.5">
          {tips.map((t, i) => <li key={i} className="text-cream/65 text-xs leading-relaxed flex gap-2"><span style={{ color: accent }}>›</span>{t}</li>)}
        </ul>

        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/40 mt-4 mb-1.5">Difficulty</p>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(DIFF) as Difficulty[]).map((d) => {
            const on = diff === d;
            return (
              <button key={d} onClick={() => setDiff(d)} className="rounded-lg border p-2 text-center transition-colors" style={on ? { borderColor: `${accent}aa`, background: `${accent}1f` } : { borderColor: "rgba(255,255,255,0.1)" }}>
                <span className="block text-cream text-sm font-semibold" style={on ? { color: accent } : undefined}>{DIFF[d].label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-cream/55 text-[11px] leading-relaxed mt-2 min-h-[2.4em]">{DIFF[diff].desc}</p>

        <button onClick={() => onStart(diff)} className="mt-3 w-full min-h-[46px] rounded-xl font-bold text-sm text-[#04080F] flex items-center justify-center gap-2" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}aa)` }}>
          <Clock size={16} weight="bold" /> Clock in · {DIFF[diff].label}
        </button>
      </div>
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
        {state.started && state.difficulty !== "normal" && (
          <span className="font-mono text-[8px] uppercase tracking-wider px-1 py-0.5 rounded border" style={{ color: state.difficulty === "hard" ? "#EF4444" : "#2BBE6B", borderColor: state.difficulty === "hard" ? "#EF444455" : "#2BBE6B55" }}>{DIFF[state.difficulty].label}</span>
        )}
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
        {state.streak >= 2 && (
          <span className="flex items-center gap-1 tabular-nums" style={{ color: state.streak >= 5 ? "#FF6B35" : "#F59E0B" }} title="Resolve streak">
            <Lightning size={12} weight="fill" aria-hidden="true" />x{state.streak}
          </span>
        )}
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
            const remaining = (st.landedAt ?? (i.revealedBy ? elapsed : i.arriveAfter)) + slaBudget(shift, i.priority, state.difficulty) - elapsed;
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
                    {channel === "phone" && i.phone ? ` · "${i.phone.opener.slice(0, 60)}..."` : ""}
                    {channel === "email" && i.email ? ` · ${i.email.body.slice(0, 60)}...` : ""}
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
  const elapsed = shift.durationSeconds - state.secondsLeft;
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
            const enroute = state.pendingOrders.filter((o) => o.sku === p.sku);
            const lead = leadFor(p);
            const tooBroke = state.budget < p.unitCost;
            return (
              <tr key={p.sku} className="border-t border-white/[0.05]">
                <td className="py-2.5 text-cream">
                  {p.name}
                  {enroute.length > 0 && (
                    <span className="ml-2 font-mono text-[9px] text-electric/80">
                      +{enroute.length} en route · {Math.max(0, Math.min(...enroute.map((o) => o.arrivesAt - elapsed)))}s
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-cream/55 text-xs">{p.vendor} <span className="text-cream/35">· {lead}s</span></td>
                <td className="py-2.5 text-right tabular-nums" style={{ color: stock === 0 ? "#EF4444" : "#9FB2CC" }}>{stock}</td>
                <td className="py-2.5 text-right text-cream/60 tabular-nums">${p.unitCost}</td>
                <td className="py-2.5 text-right">
                  <button disabled={tooBroke} onClick={() => dispatch({ t: "ORDER", sku: p.sku })} className="px-2.5 py-1 rounded-md border border-electric/40 text-electric text-[11px] hover:bg-electric/10 transition-colors disabled:opacity-35 disabled:cursor-not-allowed">Order</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="font-mono text-[10px] text-cream/35 mt-3">Parts take time to arrive, so order early. To send a part to a user, open their ticket and ship it from there.</p>
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
  const slaRemaining = (it.landedAt ?? (item.revealedBy ? elapsed : item.arriveAfter)) + slaBudget(shift, item.priority, state.difficulty) - elapsed;
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

        {part && (() => {
          const inStock = state.stock[part.sku] ?? 0;
          const enroute = state.pendingOrders.filter((o) => o.sku === part.sku);
          const eta = enroute.length ? Math.max(0, Math.min(...enroute.map((o) => o.arrivesAt - elapsed))) : null;
          return (
            <ToolBox label="Stockroom" done={stepDone("part")}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-cream/75">
                  {part.name} · in stock: <span style={{ color: inStock > 0 ? "#2BBE6B" : "#EF4444" }}>{inStock}</span>
                  {eta !== null && <span className="ml-2 text-electric/80 font-mono text-[11px]">arriving in {eta}s</span>}
                </span>
                <span className="flex gap-2">
                  {inStock <= 0 && <button onClick={() => dispatch({ t: "ORDER", sku: part.sku })} className="px-2.5 py-1 rounded-md border border-electric/40 text-electric hover:bg-electric/10">Order (${part.unitCost})</button>}
                  <button disabled={inStock <= 0} onClick={() => dispatch({ t: "SHIP", sku: part.sku })} className="px-2.5 py-1 rounded-md border border-white/15 text-cream/70 hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed">Ship to user</button>
                </span>
              </div>
              {inStock <= 0 && eta === null && <p className="font-mono text-[10px] text-cream/40 mt-1.5">Not in stock. Order it now so it lands before the SLA runs out.</p>}
            </ToolBox>
          );
        })()}

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

      {/* hint (hidden under the Skeleton Crew modifier) */}
      {!shift.noHints && (
        <div className="mt-3">
          {showHint ? (
            <p className="text-cream/65 text-xs rounded-lg border border-gold/20 bg-gold/[0.05] p-2.5">💡 {item.hint}</p>
          ) : (
            <button onClick={() => setShowHint(true)} className="font-mono text-[11px] text-cream/45 hover:text-gold">need a hint?</button>
          )}
        </div>
      )}

      {/* lifelines */}
      {!isTerminal(it.status) && (
        <div className="flex items-center gap-2 mt-4">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/40">Lifelines</span>
          <button
            onClick={() => dispatch({ t: "COFFEE" })}
            disabled={state.lifelines.coffee <= 0 || item.channel !== "phone" || it.steps.includes("phone")}
            title="Reset the active call's patience"
            className="font-mono text-[11px] px-2 py-1 rounded-md border border-white/15 text-cream/75 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed"
          >☕ Coffee ({state.lifelines.coffee})</button>
          <button
            onClick={() => dispatch({ t: "SENIOR", id: item.id })}
            disabled={state.lifelines.senior <= 0 || state.revealed.includes(item.id)}
            title="A senior reveals the right move on this item"
            className="font-mono text-[11px] px-2 py-1 rounded-md border border-white/15 text-cream/75 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed"
          >🎓 Ask a senior ({state.lifelines.senior})</button>
        </div>
      )}

      {/* actions */}
      {!isTerminal(it.status) ? (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">Choose your move · {item.goal}</p>
            {(() => {
              const triesLeft = Math.max(0, DIFF[state.difficulty].attempts - it.attempts);
              const tColor = triesLeft <= 1 ? "#EF4444" : triesLeft === 2 ? "#F59E0B" : "#2BBE6B";
              return (
                <span className="ml-auto font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded tabular-nums" style={{ color: tColor, background: `${tColor}1f`, border: `1px solid ${tColor}40` }} title="Wrong moves are limited. Run out and the item locks.">
                  {triesLeft} tr{triesLeft === 1 ? "y" : "ies"} left
                </span>
              );
            })()}
          </div>
          <div className="grid gap-2">
            {item.actions.map((act) => {
              const recommended = state.revealed.includes(item.id) && act.correct;
              return (
                <button key={act.id} onClick={() => dispatch({ t: "RESOLVE", id: item.id, actionId: act.id })} className="text-left rounded-xl border bg-white/[0.02] hover:bg-white/[0.05] transition-colors p-3" style={recommended ? { borderColor: "rgba(255,215,0,0.55)", background: "rgba(255,215,0,0.06)" } : { borderColor: "rgba(255,255,255,0.1)" }}>
                  <span className="flex items-center gap-2">
                    <span className="text-cream text-sm">{act.label}</span>
                    {recommended && <span className="ml-auto shrink-0 font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/30">senior's pick</span>}
                  </span>
                  {act.detail && <span className="block font-mono text-[11px] text-cream/50 mt-0.5">{act.detail}</span>}
                </button>
              );
            })}
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
  const pinned = runtime.steps.includes("phone");
  const patience = runtime.patience ?? 100;
  const onCall = !pinned && !isTerminal(runtime.status);
  const pColor = patience >= 60 ? "#2BBE6B" : patience >= 30 ? "#F59E0B" : "#EF4444";
  return (
    <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      {/* live patience meter while you're on the line */}
      {onCall && (
        <div className="flex items-center gap-2 mb-2.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/45">Caller patience</span>
          <span className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/10">
            <span className="block h-full transition-[width] duration-500" style={{ width: `${patience}%`, background: pColor }} />
          </span>
          <span className="font-mono text-[10px] tabular-nums" style={{ color: pColor }}>{Math.round(patience)}%</span>
        </div>
      )}
      <div className="space-y-2">
        <Bubble who="user" text={item.phone!.opener} />
        {chosen !== null && <Bubble who="you" text={fu[chosen].label} />}
        {chosen !== null && <Bubble who="user" text={fu[chosen].reply} />}
      </div>
      {pinned ? (
        <p className="mt-3 font-mono text-[10px] text-[#2BBE6B]">✓ You pinned the issue. Choose your fix below.</p>
      ) : !isTerminal(runtime.status) && (
        <div className="mt-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/45 mb-1.5">Text back (ask the right question first):</p>
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

function ShiftReport({ shift, state, onReplay, onExit, bankedFangs, bankPending }: { shift: Shift; state: State; onReplay?: () => void; onExit?: () => void; bankedFangs?: number | null; bankPending?: boolean }) {
  const live = shift.items.filter((i) => isLive(i, state.items));
  const resolved = live.filter((i) => ["resolved", "escalated", "archived", "reported"].includes(state.items[i.id].status));
  const fumbled = live.filter((i) => state.items[i.id].status === "mishandled");
  const open = live.filter((i) => state.items[i.id].status === "queued");
  const breaches = live.filter((i) => state.items[i.id].breached).length;
  const { score, grade } = computeResult(shift, state);
  const gradeColor = grade === "S" || grade === "A" ? "#2BBE6B" : grade === "B" ? "#4A90D9" : grade === "C" ? "#F59E0B" : "#EF4444";

  // The teaching content lives in each action's `teach`. During a shift it only
  // flashes in a 4.2s toast, so the report is where the lesson actually lands:
  // every item shows the correct move and why, and a fumble shows the contrast
  // between what the player picked and what they should have.
  const correctActionOf = (i: ShiftItem) => i.actions.find((act) => act.correct) ?? null;
  const chosenActionOf = (i: ShiftItem) => {
    const cid = state.items[i.id].chosenActionId;
    return cid ? i.actions.find((act) => act.id === cid) ?? null : null;
  };

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
            { label: "resolved", value: `${resolved.length}/${live.length}`, color: "#2BBE6B" },
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
          <div className="mb-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-red-400 mb-2">What went wrong · learn the fix</p>
            <ul className="space-y-2">
              {fumbled.map((i) => {
                const chosen = chosenActionOf(i);
                const right = correctActionOf(i);
                return (
                  <li key={i.id} className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-2.5">
                    <p className="text-cream/90 text-xs font-semibold">{i.subject}</p>
                    {chosen ? (
                      <p className="text-cream/65 text-[11px] leading-relaxed mt-1.5"><span className="text-red-400 font-semibold">You picked:</span> {chosen.label}.{chosen.teach ? ` ${chosen.teach}` : ""}</p>
                    ) : (
                      <p className="text-cream/55 text-[11px] leading-relaxed mt-1.5">No fix was committed before the caller hung up.</p>
                    )}
                    {right && (
                      <p className="text-cream/75 text-[11px] leading-relaxed mt-1"><span className="text-[#2BBE6B] font-semibold">Right move:</span> {right.label}. {right.teach}</p>
                    )}
                  </li>
                );
              })}
            </ul>
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

        {state.bestStreak >= 3 && (
          <p className="font-mono text-[10px] text-gold/80 mb-3">Best streak this shift: x{state.bestStreak}{state.difficulty !== "normal" ? ` · ${DIFF[state.difficulty].label}` : ""}{!computeResult(shift, state).usedLifeline ? " · no lifelines" : ""}</p>
        )}

        {(() => {
          const r = managerReviewFor({
            track: shift.track,
            shiftId: shift.id,
            grade,
            resolved: resolved.length,
            total: live.length,
            breaches,
            fumbles: fumbled.length,
          });
          return (
            <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
              <div className="flex items-start gap-3">
                <span
                  className="shrink-0 grid h-9 w-9 place-items-center rounded-full font-bebas text-lg leading-none"
                  style={{ background: `${r.accent}22`, color: r.accent, border: `1px solid ${r.accent}55` }}
                  aria-hidden="true"
                >
                  {r.initial}
                </span>
                <div className="min-w-0">
                  <p className="text-cream/90 text-xs font-semibold leading-none">{r.name}</p>
                  <p className="font-mono text-[9px] uppercase tracking-wider text-cream/40 mt-1">{r.role} · debrief</p>
                  <p className="text-cream/75 text-[13px] leading-relaxed mt-2">{r.verdict}</p>
                </div>
              </div>
            </div>
          );
        })()}

        <QuickRecall fumbled={fumbled} resolved={resolved} />

        <details className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.015]">
          <summary className="cursor-pointer select-none px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-cream/55 hover:text-cream">Full recap · the right move on every item ({live.length})</summary>
          <ul className="px-3 pb-3 space-y-2.5">
            {live.map((i) => {
              const st = state.items[i.id].status;
              const right = correctActionOf(i);
              return (
                <li key={i.id}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ color: STATUS_COLOR[st], background: `${STATUS_COLOR[st]}1f` }}>{STATUS_LABEL[st]}</span>
                    <span className="text-cream/80 truncate">{i.subject}</span>
                  </div>
                  {right && <p className="text-cream/55 text-[11px] leading-relaxed mt-1"><span className="text-[#2BBE6B]/90">Right move:</span> {right.label}. {right.teach}</p>}
                </li>
              );
            })}
          </ul>
        </details>

        {typeof bankedFangs === "number" && bankedFangs > 0 ? (
          <p className="font-mono text-[10px] text-[#2BBE6B] leading-relaxed mb-4">
            ✓ {bankedFangs} Fangs banked to your balance, validated server-side. XP is preview-only for now.
          </p>
        ) : bankPending ? (
          <p className="font-mono text-[10px] text-cream/35 leading-relaxed mb-4">
            Fangs and XP are a preview. They bank for real once the server economy goes live, so the economy stays tamper-proof.
          </p>
        ) : (
          <p className="font-mono text-[10px] text-cream/35 leading-relaxed mb-4">
            Fangs and XP are a preview. They are granted for real once a shift is validated server-side, so the economy stays tamper-proof.
          </p>
        )}

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

/* ───────────────────── quick recall (retrieval check) ───────────────────── */

// One optional retrieval check on the shift report, shown above the Full recap.
// It re-asks a single item the player just fumbled this shift (fallback: a
// random item they resolved), using ONLY the item's already-authored ActionCard
// labels + teach strings: the item's correct action paired with one wrong
// distractor that already exists on the item. No content is invented, nothing is
// granted (display-only). Items without both a correct and a wrong action are
// skipped, so there is always a real distractor to choose between.
type Recall = { item: ShiftItem; choices: ShiftItem["actions"]; correctId: string };

function recallEligible(i: ShiftItem): boolean {
  return i.actions.length >= 2 && i.actions.some((a) => a.correct) && i.actions.some((a) => !a.correct);
}

function buildRecall(fumbled: ShiftItem[], resolved: ShiftItem[]): Recall | null {
  const src = fumbled.filter(recallEligible);
  const pool = src.length ? src : resolved.filter(recallEligible);
  if (!pool.length) return null;
  const item = pool[Math.floor(Math.random() * pool.length)];
  const correct = item.actions.find((a) => a.correct)!;
  const wrongs = item.actions.filter((a) => !a.correct);
  const distractor = wrongs[Math.floor(Math.random() * wrongs.length)];
  // Two choices only, order randomized so the right answer is not always first.
  const choices = Math.random() < 0.5 ? [correct, distractor] : [distractor, correct];
  return { item, choices, correctId: correct.id };
}

function QuickRecall({ fumbled, resolved }: { fumbled: ShiftItem[]; resolved: ShiftItem[] }) {
  // Pick the item + shuffle exactly once. Frozen for the life of the report so it
  // never reshuffles on a re-render (e.g. when the server-banked Fangs prop lands).
  const [recall] = useState(() => buildRecall(fumbled, resolved));
  const [answered, setAnswered] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (!recall || dismissed) return null;
  const { item, choices, correctId } = recall;
  const chosen = answered ? item.actions.find((a) => a.id === answered) ?? null : null;
  const right = item.actions.find((a) => a.id === correctId) ?? null;
  const ok = answered !== null && answered === correctId;
  const verdict = ok ? "#2BBE6B" : "#EF4444";
  // Re-present the incoming scenario (the spec's "scenario one-liner"): the phone
  // opener, email body, or ticket body, mirroring the ChannelList preview slice
  // and collapsed to a single line. Falls back to the goal if an item carries no
  // body text.
  const scenarioRaw = (
    item.channel === "phone" ? item.phone?.opener :
    item.channel === "email" ? item.email?.body :
    item.ticketBody
  )?.replace(/\s+/g, " ").trim();
  const scenario = scenarioRaw && scenarioRaw.length > 120 ? `${scenarioRaw.slice(0, 120).trimEnd()}...` : (scenarioRaw || item.goal);

  return (
    <div className="mb-4 rounded-xl border border-purple-400/25 bg-purple-400/[0.05] p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <Lightning size={13} weight="fill" color="#A855F7" aria-hidden="true" />
        <p className="font-mono text-[10px] uppercase tracking-wider text-purple-300">Quick recall</p>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss quick recall" className="ml-auto grid h-5 w-5 place-items-center rounded text-cream/40 hover:text-cream/80 hover:bg-white/[0.06] transition-colors">
          <X size={12} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <p className="text-cream/90 text-xs font-semibold">{item.subject}</p>
      <p className="text-cream/65 text-[11px] leading-relaxed mt-0.5">{scenario}</p>

      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mt-3 mb-1.5">Choose your move</p>
      <div className="grid gap-2">
        {choices.map((act) => {
          const revealed = answered !== null;
          const isRight = act.id === correctId;
          const isChosen = answered === act.id;
          return (
            <button
              key={act.id}
              disabled={revealed}
              onClick={() => setAnswered(act.id)}
              className={`text-left rounded-xl border bg-white/[0.02] transition-colors p-2.5 ${revealed ? "cursor-default" : "hover:bg-white/[0.05]"}`}
              style={
                !revealed
                  ? { borderColor: "rgba(255,255,255,0.1)" }
                  : isRight
                  ? { borderColor: "rgba(43,190,107,0.55)", background: "rgba(43,190,107,0.08)" }
                  : isChosen
                  ? { borderColor: "rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.07)" }
                  : { borderColor: "rgba(255,255,255,0.07)", opacity: 0.5 }
              }
            >
              <span className="flex items-center gap-2">
                <span className="text-cream text-sm">{act.label}</span>
                {revealed && isRight && <CheckCircle size={14} weight="fill" color="#2BBE6B" className="ml-auto shrink-0" aria-hidden="true" />}
                {revealed && isChosen && !isRight && <span className="ml-auto shrink-0 font-bold text-sm" style={{ color: "#EF4444" }} aria-hidden="true">✕</span>}
              </span>
            </button>
          );
        })}
      </div>

      {answered !== null && chosen && (
        <div className="mt-2.5 rounded-lg border p-2.5" style={{ borderColor: `${verdict}55`, background: `${verdict}12`, animation: "ld-toast-in 240ms ease-out" }}>
          <p className="font-bebas text-base tracking-wide leading-none" style={{ color: verdict }}>{ok ? "CORRECT" : "NOT QUITE"}</p>
          <p className="text-cream/75 text-[11px] leading-relaxed mt-1.5">{chosen.teach}</p>
          {!ok && right && (
            <p className="text-cream/75 text-[11px] leading-relaxed mt-1"><span className="text-[#2BBE6B] font-semibold">Right move:</span> {right.label}. {right.teach}</p>
          )}
        </div>
      )}
    </div>
  );
}
