"use client";

import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type Dispatch, type ReactNode, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  EnvelopeSimple, Ticket, DeviceMobile, Package, BookBookmark, IdentificationBadge,
  Clock, CheckCircle, ArrowLeft, MagnifyingGlass, Lightning, Trophy, ArrowClockwise,
  SpeakerHigh, SpeakerSlash, X, WarningOctagon, Compass, Gear, ImageSquare, DownloadSimple, LinkSimple,
  CaretLeft, CaretRight,
} from "@phosphor-icons/react";
import Link from "next/link";
import { createPortal } from "react-dom";
import type { AppId, ShiftItem, Shift, Priority } from "@/lib/liondesk/types";
import { playArrival, playResolve, playBreach, playFail, playWin, playClockIn, playDelivery, playStreak, playEscalate, playBridgeSpike, startDeskHum, stopDeskHum, resumeAudio, isMuted, setMuted, isAmbientEnabled, setAmbientEnabled, getVolume, setVolume } from "@/lib/liondesk/sound";
import { getEquippedTheme, type DeskTheme } from "@/lib/liondesk/themes";
import { managerReviewFor } from "@/lib/liondesk/managerReview";
import { slaRemaining } from "@/lib/liondesk/scoring";
import { CONCEPTS, conceptForItem } from "@/lib/liondesk/concepts";
import { takeNextCoachMark, type CoachMarkDef } from "@/lib/liondesk/coachmarks";
import { getTrack } from "@/lib/helpdesk/tracks";
import { encodeCombo } from "@/lib/liondesk/combocode";
import { renderShareCardDataUrl, renderShareCardBlob, shareCardFilename, type ShareCardData } from "@/lib/liondesk/shareCard";
import { buildReplayTimeline, type ReplayDecision } from "@/lib/liondesk/replay";

import {
  type ShiftResult, type State, type Action, type ItemRuntime, type ItemStatus,
  type Difficulty, type FeedEntry, type FeedTone,
  DIFF, GOOD_STATUSES, BRIDGE_STAGE_1, BRIDGE_STAGE_2, BRIDGE_STAGE_3,
  isTerminal, isLive, slaBudget, leadFor, buildInitial, makeReducer, computeResult,
} from "@/lib/liondesk/engine";

// The game logic (reducer, SLA/patience/streak math, scoring, all the state
// types and tuning constants) now lives in @/lib/liondesk/engine, a pure,
// framework-free module that can be unit-tested without React. This file keeps
// only the React components + effects. ShiftResult is re-exported so existing
// importers (components/liondesk/Campaign.tsx, lib/liondesk/stats.ts) keep
// importing it from here unchanged.
export type { ShiftResult };

/**
 * Renders children into document.body via a portal, so a modal escapes the desk
 * container's `overflow-hidden` (and any transformed ancestor that would trap
 * position:fixed). This is what keeps the shift-report and clock-in buttons
 * reachable instead of clipped by the desk panel. Mounted-guarded for SSR.
 */
function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/* ───────────────────────── view helpers ───────────────────────── */

const PRIORITY_COLOR: Record<Priority, string> = { P1: "#EF4444", P2: "#F59E0B", P3: "#4A90D9", P4: "#6B7280" };

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Screen-reader-friendly time. "4:30" reads as "four colon thirty"; this spells
// it out as "4 minutes 30 seconds" for an aria-label so the clock makes sense
// without sight. Display copy is unchanged; this is the accessible name only.
function spokenTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const mm = m > 0 ? `${m} minute${m === 1 ? "" : "s"}` : "";
  const ss = `${s} second${s === 1 ? "" : "s"}`;
  return m > 0 ? `${mm} ${ss}` : ss;
}

// Roving focus for a group of action buttons: Up/Down (and Left/Right) move
// focus between the choices, wrapping at the ends. This is focus movement only,
// it never triggers a choice (Enter/Space still does that), so gameplay is
// untouched. Used on the "Choose your move" group in WorkView.
function onGroupArrowKeys(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button")).filter((b) => !b.disabled);
  if (btns.length === 0) return;
  const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
  if (idx === -1) return;
  e.preventDefault();
  const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
  const next = fwd ? (idx + 1) % btns.length : (idx - 1 + btns.length) % btns.length;
  btns[next].focus();
}

// Modal focus management shared by ClockIn and ShiftReport: on open, move focus
// to the dialog surface (so its label is announced and Tab starts at the top),
// trap Tab within it while it is mounted, and restore focus to the previously
// focused element on dismiss. Purely additive; it changes no game state.
function useDialogFocus<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const root = ref.current;
    root?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) { e.preventDefault(); root.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // If focus has fallen outside the dialog (e.g. the browser moved it to
      // body after the focused control was disabled or unmounted, such as
      // answering or dismissing the Quick recall card), pull it back in.
      if (!root.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey) {
        if (active === first || active === root) { e.preventDefault(); last.focus(); }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, []);
  return ref;
}

// Join a list of names into readable prose ("A", "A and B", "A, B, and C").
// Comma based so it never introduces a dash. Used by the Real world skills recap.
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
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

export default function LionDesk({ shift, onComplete, onExit, onReplay, bankedFangs, bankPending }: { shift: Shift; onComplete?: (r: ShiftResult, state: State) => void; onExit?: () => void; onReplay?: () => void; bankedFangs?: number | null; bankPending?: boolean }) {
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

  // Fire the completion callback exactly once when the shift ends. The final
  // per-item State is handed alongside the result so a play screen can fold the
  // exact per-item outcomes into concept mastery (recordShiftConcepts) rather
  // than estimating from the result. Callers that only need the result can
  // ignore the second argument.
  useEffect(() => {
    if (state.ended && !completedRef.current) {
      completedRef.current = true;
      onComplete?.(computeResult(shift, state), state);
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

  // ── Sound + theme + settings ──
  const [muted, setMutedState] = useState(false);
  const [ambient, setAmbientState] = useState(true);
  const [volume, setVolumeState] = useState(1);
  const [settingsReady, setSettingsReady] = useState(false);
  const [theme, setTheme] = useState<DeskTheme | null>(null);
  // Read the persisted prefs once on the client. settingsReady gates the settings
  // popover so it never paints a localStorage value before it is known (no flash of
  // a wrong number); the volume readout shows a placeholder until then.
  useEffect(() => {
    setMutedState(isMuted());
    setAmbientState(isAmbientEnabled());
    setVolumeState(getVolume());
    setTheme(getEquippedTheme());
    setSettingsReady(true);
  }, []);
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
  const soundPrev = useRef<{ landed: number; resolved: number; escalated: number; breached: number; mishandled: number; ended: boolean; stockSum: number; streak: number; started: boolean; bridgeStage: number } | null>(null);
  useEffect(() => {
    const el = shift.durationSeconds - state.secondsLeft;
    const landedN = shift.items.filter((i) => el >= i.arriveAfter && isLive(i, state.items)).length;
    const resolvedN = shift.items.filter((i) => GOOD_STATUSES.includes(state.items[i.id].status)).length;
    const escalatedN = shift.items.filter((i) => state.items[i.id].status === "escalated").length;
    const breachedN = shift.items.filter((i) => state.items[i.id].breached).length;
    const mishandledN = shift.items.filter((i) => state.items[i.id].status === "mishandled").length;
    const stockSum = Object.values(state.stock).reduce((a, b) => a + b, 0);
    const p = soundPrev.current;
    if (p) {
      // Independent checks: a single tick can both land a ticket and breach
      // another, and each cue must fire (an else-if would drop one for good).
      if (breachedN > p.breached) playBreach();
      if (mishandledN > p.mishandled) playFail();
      // Escalating a ticket up the chain and resolving it yourself are both
      // GOOD_STATUSES, but they get different cues. Subtracting escalations from
      // the good count keeps each outcome to exactly one sound, so an escalate
      // plays only the escalate motif and never doubles up with the resolve chime.
      if (escalatedN > p.escalated) playEscalate();
      if (resolvedN - escalatedN > p.resolved - p.escalated) playResolve();
      if (landedN > p.landed) playArrival();
      if (stockSum > p.stockSum) playDelivery(); // stock only ever rises on a delivery
      if (state.streak > p.streak && [3, 5, 8, 12].includes(state.streak)) playStreak();
      // Bridge Pressure crossed into a new tension stage (1..3): a rising spike
      // that gets more urgent the higher the stage. bridgeStage only ever climbs
      // while a major incident is open, so this fires once per stage.
      if (state.bridgeStage > p.bridgeStage) playBridgeSpike(state.bridgeStage);
      // Clocking in starts the ambient office hum (the click is the user gesture
      // that lets it play); the shift ending stops it. Both fire exactly once.
      if (state.started && !p.started) { playClockIn(); startDeskHum(); }
      if (state.ended && !p.ended) { playWin(); stopDeskHum(); }
    }
    soundPrev.current = { landed: landedN, resolved: resolvedN, escalated: escalatedN, breached: breachedN, mishandled: mishandledN, ended: state.ended, stockSum, streak: state.streak, started: state.started, bridgeStage: state.bridgeStage };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  // Stop the ambient hum if the desk unmounts mid-shift (navigating away, or a
  // replay remount), so it never lingers after the component is gone.
  useEffect(() => () => { stopDeskHum(); }, []);
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    // Muting silences the cues and the ambient hum at once; unmuting brings the
    // office hum back, but only while a shift is actually live.
    if (next) {
      stopDeskHum();
    } else {
      resumeAudio();
      if (state.started && !state.ended) startDeskHum();
    }
  }

  // The settings popover writes the ambient hum preference (sound.ts owns the
  // single source of truth and its persistence) and mirrors the live hum to it:
  // turning it off stops the bed now, turning it on restarts it only while a shift
  // is live and not muted. No new state is duplicated, this reflects the same
  // `ambient` value the popover reads.
  function toggleAmbient() {
    const next = !ambient;
    setAmbientEnabled(next);
    setAmbientState(next);
    if (next) {
      if (!muted && state.started && !state.ended) { resumeAudio(); startDeskHum(); }
    } else {
      stopDeskHum();
    }
  }

  // Master volume (0..1). sound.ts persists it and ramps the live master gain so
  // the change is audible immediately; this only mirrors it for the slider.
  function changeVolume(v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    resumeAudio();
    setVolume(clamped);
    setVolumeState(clamped);
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

  // Desk visual ambiance (idea 30). The `ld-ambient` class hangs a calm CSS
  // lighting wash and an incident crimson vignette on the desk root's pseudo
  // elements (see app/globals.css). `data-ld-alert` carries the live Bridge
  // Pressure stage (0..3) so the crimson layer fades in and pulses harder as the
  // incident escalates. It is CSS only, adds no markup, and causes no layout
  // shift; the pulse is gated by the .ld-motion-scope reduced motion rule.
  return (
    <div data-ld-alert={state.bridgeStage} className="ld-motion-scope ld-ambient relative rounded-2xl border border-white/[0.08] overflow-hidden" style={{ backgroundColor: shift.graveyard ? "#04060c" : (theme?.bg ?? "#070b14"), backgroundImage: (theme?.scanlines || shift.graveyard) ? "repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px)" : undefined }}>
      <style>{`@keyframes ld-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes ld-toast-life{0%{opacity:0;transform:translateY(8px)}6%{opacity:1;transform:translateY(0)}84%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-6px)}}@keyframes ld-bridge-pulse{0%,100%{box-shadow:inset 0 0 0 0 rgba(239,68,68,0)}50%{box-shadow:inset 0 0 26px 0 rgba(239,68,68,0.28)}}.ld-bridge-pulse{animation:ld-bridge-pulse 1.8s ease-in-out infinite}.ld-bridge-fill{transition:width 600ms ease-out}@media (prefers-reduced-motion: reduce){.ld-bridge-fill{transition:none}.ld-bridge-pulse{animation:none}}`}</style>
      <StatusBar shift={shift} state={state} resolved={resolvedCount} total={liveItems.length} onEnd={() => dispatch({ t: "END" })} muted={muted} onToggleMute={toggleMute} ambient={ambient} onToggleAmbient={toggleAmbient} volume={volume} onVolume={changeVolume} settingsReady={settingsReady} />
      <BridgePressureBar state={state} />

      <div className="grid grid-cols-[64px_1fr] min-h-[560px]">
        {/* Dock */}
        <div className="border-r border-white/[0.06] bg-white/[0.015] py-3 flex flex-col items-center gap-2" role="group" aria-label="Desk apps">
          {APPS.filter((app) => usedApps.has(app.id)).map(({ id, label, Icon }) => {
            const active = state.activeApp === id && !activeItem;
            const badge = openByApp(id);
            return (
              <button
                key={id}
                onClick={() => dispatch({ t: "APP", app: id })}
                title={label}
                aria-label={badge > 0 ? `${label}, ${badge} open` : label}
                aria-pressed={active}
                className={`relative w-11 h-11 rounded-xl flex items-center justify-center border transition-colors ${active ? "" : "border-transparent hover:bg-white/[0.05]"}`}
                style={active ? { background: `${accent}26`, borderColor: `${accent}80` } : undefined}
              >
                <Icon size={20} weight={active ? "fill" : "regular"} color={active ? accent : "#9FB2CC"} aria-hidden="true" />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center" aria-hidden="true">{badge}</span>
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
  const dialogRef = useDialogFocus();
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
    <ModalPortal>
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ld-clockin-title" tabIndex={-1} className="w-full max-w-md rounded-2xl border bg-[#0a0f1c] p-6 max-h-[92vh] overflow-y-auto focus:outline-none" style={{ borderColor: `${accent}55` }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: accent }}>{shift.rank} · clocking in</p>
        <h3 id="ld-clockin-title" className="font-bebas text-3xl text-cream tracking-wide leading-none mt-1">{shift.name}</h3>

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

        <p id="ld-difficulty-label" className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/40 mt-4 mb-1.5">Difficulty</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="ld-difficulty-label">
          {(Object.keys(DIFF) as Difficulty[]).map((d) => {
            const on = diff === d;
            return (
              <button key={d} onClick={() => setDiff(d)} aria-pressed={on} className="rounded-lg border p-2 text-center transition-colors" style={on ? { borderColor: `${accent}aa`, background: `${accent}1f` } : { borderColor: "rgba(255,255,255,0.1)" }}>
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
    </ModalPortal>
  );
}

/* ───────────────────────── status bar ───────────────────────── */

function StatusBar({ shift, state, resolved, total, onEnd, muted, onToggleMute, ambient, onToggleAmbient, volume, onVolume, settingsReady }: { shift: Shift; state: State; resolved: number; total: number; onEnd: () => void; muted: boolean; onToggleMute: () => void; ambient: boolean; onToggleAmbient: () => void; volume: number; onVolume: (v: number) => void; settingsReady: boolean }) {
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
        <span className="flex items-center gap-1.5" style={{ color: low ? "#EF4444" : "#9FB2CC" }} role="timer" aria-label={`Time remaining ${spokenTime(state.secondsLeft)}`}>
          <Clock size={13} weight="bold" aria-hidden="true" /> {fmt(state.secondsLeft)}
        </span>
        <span className="flex items-center gap-1.5" title="User satisfaction" role="progressbar" aria-valuenow={state.csat} aria-valuemin={0} aria-valuemax={100} aria-label="Customer satisfaction">
          <span className="text-cream/45" aria-hidden="true">CSAT</span>
          <span className="w-16 h-1.5 rounded-full overflow-hidden bg-white/10 hidden sm:inline-block align-middle" aria-hidden="true">
            <span className="block h-full" style={{ width: `${state.csat}%`, background: csatColor }} />
          </span>
          <span style={{ color: csatColor }} aria-hidden="true">{state.csat}%</span>
        </span>
        {state.streak >= 2 && (
          <span className="flex items-center gap-1 tabular-nums" style={{ color: state.streak >= 5 ? "#FF6B35" : "#F59E0B" }} title="Resolve streak" aria-label={`Resolve streak, ${state.streak} in a row`}>
            <Lightning size={12} weight="fill" aria-hidden="true" />x{state.streak}
          </span>
        )}
        <span className="text-gold tabular-nums" aria-label={`${state.fangs} Fangs this shift`}>{state.fangs} Fangs</span>
        <span className="text-cream/55 tabular-nums" aria-label={`${resolved} of ${total} items resolved`}>{resolved}/{total}</span>
        <button onClick={onToggleMute} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute sounds" : "Mute sounds"} className="w-7 h-7 rounded-md border border-white/15 text-cream/60 hover:bg-white/[0.06] hover:text-cream transition-colors flex items-center justify-center">
          {muted ? <SpeakerSlash size={13} weight="fill" aria-hidden="true" /> : <SpeakerHigh size={13} weight="fill" aria-hidden="true" />}
        </button>
        <SettingsControl state={state} muted={muted} onToggleMute={onToggleMute} ambient={ambient} onToggleAmbient={onToggleAmbient} volume={volume} onVolume={onVolume} settingsReady={settingsReady} />
        <button onClick={onEnd} className="px-2.5 py-1 rounded-md border border-white/15 text-cream/70 hover:bg-white/[0.06] hover:text-cream transition-colors uppercase tracking-wider text-[10px]">
          End shift
        </button>
      </div>
      {/* Urgent-only announcement. The string is constant while urgent, so it is
          spoken once when time runs low and never repeats on every tick. */}
      <span className="sr-only" aria-live="assertive">{state.started && !state.ended && low ? "Under one minute left in the shift." : ""}</span>
    </div>
  );
}

/* ───────────────────────── in-desk settings ───────────────────────── */

// A small glassmorphism settings popover, opened from a gear in the desk chrome.
// It surfaces (and writes) the existing sound preferences, master volume, mute,
// and the batch 4 ambient office hum, plus two read only reminders: whether the OS
// reduced motion setting is on, and which difficulty this shift is running. It owns
// no sound state of its own, it reads and writes the same prefs the desk already
// holds (sound.ts is the single source of truth), so nothing can drift. The panel
// is a focus trapped dialog (consistent with the clock in and report dialogs) and
// is dismissible by the close button, Escape, or a click outside.
function SettingsControl({ state, muted, onToggleMute, ambient, onToggleAmbient, volume, onVolume, settingsReady }: { state: State; muted: boolean; onToggleMute: () => void; ambient: boolean; onToggleAmbient: () => void; volume: number; onVolume: (v: number) => void; settingsReady: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Desk settings"
        aria-label="Desk settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-7 h-7 rounded-md border border-white/15 text-cream/60 hover:bg-white/[0.06] hover:text-cream transition-colors flex items-center justify-center"
      >
        <Gear size={13} weight="fill" aria-hidden="true" />
      </button>
      {open && (
        <SettingsPanel
          state={state}
          muted={muted}
          onToggleMute={onToggleMute}
          ambient={ambient}
          onToggleAmbient={onToggleAmbient}
          volume={volume}
          onVolume={onVolume}
          settingsReady={settingsReady}
          wrapRef={wrapRef}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SettingsPanel({ state, muted, onToggleMute, ambient, onToggleAmbient, volume, onVolume, settingsReady, wrapRef, onClose }: { state: State; muted: boolean; onToggleMute: () => void; ambient: boolean; onToggleAmbient: () => void; volume: number; onVolume: (v: number) => void; settingsReady: boolean; wrapRef: RefObject<HTMLDivElement>; onClose: () => void }) {
  const dialogRef = useDialogFocus();
  // Initialize from matchMedia so the very first painted frame already knows the
  // preference. A flag that started false would render one frame of ld-toast-in
  // before the effect below corrected it, briefly animating the panel in for a
  // reduced-motion user; reading the media query up front snaps it from frame
  // zero instead. SSR safe via the typeof window guard.
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // Track the OS reduced motion setting so the reminder is accurate and live. The
  // panel only mounts while open, so this runs on open (mirrors CoachMarkTip).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Dismiss on Escape, and swallow the desk number shortcuts while open. Capture
  // phase, so this runs before the desk wide keydown handler on the window (which
  // would otherwise also close an open ticket on Escape, or switch apps on a digit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (/^[1-9]$/.test(e.key)) {
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Dismiss on a click outside the gear plus panel.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [onClose, wrapRef]);

  const pct = Math.round(volume * 100);
  const diff = DIFF[state.difficulty];

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Desk settings"
      tabIndex={-1}
      className="absolute right-0 top-full mt-2 z-40 w-72 rounded-xl border border-white/15 p-3.5 shadow-2xl backdrop-blur-xl focus:outline-none font-syne text-left"
      style={{
        background: "linear-gradient(160deg, rgba(16,21,36,0.86) 0%, rgba(10,14,28,0.9) 100%)",
        animation: reduced ? undefined : "ld-toast-in 200ms ease-out both",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Gear size={15} weight="fill" color="#FFD700" aria-hidden="true" />
        <span className="font-bebas text-base text-cream tracking-wide leading-none">Desk settings</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="ml-auto grid h-5 w-5 place-items-center rounded text-cream/40 hover:text-cream/80 hover:bg-white/[0.06] transition-colors"
        >
          <X size={12} weight="bold" aria-hidden="true" />
        </button>
      </div>

      {/* volume */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          {muted ? <SpeakerSlash size={13} weight="fill" color="#9FB2CC" aria-hidden="true" /> : <SpeakerHigh size={13} weight="fill" color="#9FB2CC" aria-hidden="true" />}
          <label htmlFor="ld-volume" className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/55">Volume</label>
          <span className="ml-auto font-mono text-[10px] tabular-nums text-cream/60">{settingsReady ? `${pct}%` : "..."}</span>
        </div>
        <input
          id="ld-volume"
          type="range"
          min={0}
          max={100}
          step={5}
          value={settingsReady ? pct : 100}
          onChange={(e) => onVolume(Number(e.target.value) / 100)}
          aria-label="Master volume"
          className="w-full cursor-pointer"
          style={{ accentColor: "#FFD700" }}
        />
      </div>

      {/* mute plus ambient toggles */}
      <div className="space-y-2 mb-3">
        <button
          type="button"
          onClick={onToggleMute}
          role="switch"
          aria-checked={!muted}
          aria-label="All sound"
          className="w-full flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.02] px-2.5 py-2 hover:bg-white/[0.05] transition-colors"
        >
          <span className="text-cream/85 text-xs">All sound</span>
          <SettingsPill on={!muted} />
        </button>
        <button
          type="button"
          onClick={onToggleAmbient}
          role="switch"
          aria-checked={ambient}
          aria-label="Ambient office hum"
          className="w-full flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.02] px-2.5 py-2 hover:bg-white/[0.05] transition-colors"
        >
          <span className="text-cream/85 text-xs text-left">Ambient office hum</span>
          <SettingsPill on={ambient} />
        </button>
        <p className="font-mono text-[9px] text-cream/35 leading-relaxed">The hum plays while a shift is live. Mute silences everything at once.</p>
      </div>

      {/* reduced motion reminder */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.015] px-2.5 py-2 mb-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/55">Reduced motion</span>
          <span className="ml-auto font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={reduced ? { color: "#2BBE6B", background: "rgba(43,190,107,0.12)" } : { color: "#9FB2CC", background: "rgba(255,255,255,0.05)" }}>{reduced ? "On" : "Off"}</span>
        </div>
        <p className="text-cream/55 text-[11px] leading-relaxed mt-1">
          {reduced
            ? "Animations snap to their final frame, following your system setting."
            : "Follows your system setting. Turn on Reduce Motion in your OS to snap animations to their final frame."}
        </p>
      </div>

      {/* difficulty reminder */}
      <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: "rgba(168,85,247,0.25)", background: "rgba(168,85,247,0.06)" }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/55">Difficulty</span>
          <span className="ml-auto font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded text-purple-200" style={{ background: "rgba(168,85,247,0.15)" }}>{state.started ? diff.label : "Set at clock in"}</span>
        </div>
        <p className="text-cream/55 text-[11px] leading-relaxed mt-1">{state.started ? diff.desc : "You pick the difficulty when you clock in to this shift."}</p>
      </div>
    </div>
  );
}

function SettingsPill({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="ml-auto inline-flex items-center shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider border"
      style={on ? { color: "#2BBE6B", borderColor: "rgba(43,190,107,0.45)", background: "rgba(43,190,107,0.12)" } : { color: "#9FB2CC", borderColor: "rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.04)" }}
    >
      {on ? "On" : "Off"}
    </span>
  );
}

/* ───────────────────────── bridge pressure ───────────────────────── */

// Major-incident tension meter. While an incident root stays open the engine's
// Bridge Pressure climbs (the org is on the incident bridge); this surfaces it as
// a slim banner under the status bar, matching the CSAT / patience / SLA visuals.
// It is hidden when there is no pressure (pure engine state, so no flash-of-zero:
// it renders 0 the same on the server and the client and simply stays hidden).
// The fill transition and the critical-stage glow both snap to their final state
// under prefers-reduced-motion (see the ld-bridge-* rules in the root <style>).
function BridgePressureBar({ state }: { state: State }) {
  const p = Math.round(state.bridgePressure);
  if (p <= 0) return null;
  const critical = p >= BRIDGE_STAGE_3;
  const color = p >= BRIDGE_STAGE_2 ? "#EF4444" : p >= BRIDGE_STAGE_1 ? "#F59E0B" : "#FFD700";
  const stageLabel = critical
    ? "Critical"
    : p >= BRIDGE_STAGE_2 ? "Leadership on the bridge"
    : p >= BRIDGE_STAGE_1 ? "Bridge live"
    : "Spinning up";
  return (
    <div className={`flex items-center gap-3 px-4 py-2 border-b border-white/[0.06] bg-gradient-to-r from-red-500/[0.06] to-transparent ${critical ? "ld-bridge-pulse" : ""}`}>
      <span className="flex items-center gap-1.5 shrink-0">
        <WarningOctagon size={14} weight="fill" color={color} aria-hidden="true" />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/55 hidden sm:inline">Bridge pressure</span>
      </span>
      <span
        className="flex-1 min-w-0 h-1.5 rounded-full overflow-hidden bg-white/10"
        role="progressbar"
        aria-valuenow={p}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Major incident bridge pressure"
      >
        <span className="ld-bridge-fill block h-full rounded-full" style={{ width: `${p}%`, background: color }} />
      </span>
      <span className="font-mono text-[9px] uppercase tracking-wider shrink-0 hidden sm:inline" style={{ color }}>{stageLabel}</span>
      <span className="font-mono text-[10px] tabular-nums shrink-0" style={{ color }}>{p}%</span>
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
  const listLabel = channel === "email" ? "Inbox" : channel === "phone" ? "Phone queue" : "Ticket queue";
  return (
    <div className="p-4 max-h-[560px] overflow-y-auto">
      {rows.length === 0 ? (
        <div className="text-center text-cream/45 text-sm py-16">{empty}</div>
      ) : (
        <ul className="space-y-2" aria-label={listLabel}>
          {rows.map((i) => {
            const st = state.items[i.id];
            const done = isTerminal(st.status);
            const remaining = slaRemaining(i, st, elapsed, slaBudget(shift, i.priority, state.difficulty));
            const statusText = done ? STATUS_LABEL[st.status] : st.breached ? "SLA breached" : `${fmt(Math.max(0, remaining))} until SLA`;
            const itemLabel = [
              channel === "ticket" ? `Priority ${i.priority}` : null,
              i.subject,
              `from ${i.from.name}, ${i.from.role}`,
              i.from.vip ? "VIP" : null,
              statusText,
            ].filter(Boolean).join(", ");
            return (
              <li key={i.id}>
                <button onClick={() => dispatch({ t: "OPEN", id: i.id })} aria-label={itemLabel} className={`w-full text-left rounded-xl border p-3 transition-colors ${done ? "opacity-60" : "hover:bg-white/[0.04]"}`} style={{ borderColor: "rgba(255,255,255,0.08)", background: done ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.025)", animation: "ld-toast-in 240ms ease-out" }}>
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
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search the KB..." aria-label="Search the knowledge base" className="bg-transparent text-sm text-cream placeholder:text-cream/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 rounded-sm flex-1" />
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
  const remaining = slaRemaining(item, it, elapsed, slaBudget(shift, item.priority, state.difficulty));
  const kbArticle = item.kbArticleId ? shift.kb.find((a) => a.id === item.kbArticleId) ?? null : null;
  const part = item.part ? shift.inventory.find((p) => p.sku === item.part!.sku) ?? null : null;
  const stepDone = (k: string) => (k === "kb" ? state.kbRead.includes(item.kbArticleId ?? "") : it.steps.includes(k));

  return (
    <div className="p-4 max-h-[560px] overflow-y-auto">
      <button onClick={() => dispatch({ t: "CLOSE" })} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-cream/55 hover:text-electric mb-3"><ArrowLeft size={13} /> back to queue</button>

      <CoachMarkTip item={item} />

      {/* header */}
      <div className="flex items-center gap-2 mb-1">
        {item.channel === "ticket" && <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: PRIORITY_COLOR[item.priority], background: `${PRIORITY_COLOR[item.priority]}1f`, border: `1px solid ${PRIORITY_COLOR[item.priority]}40` }}>{item.priority}</span>}
        <span className="font-mono text-[9px] uppercase tracking-wider text-cream/40">{item.channel} · SLA {item.slaMinutes}m</span>
        {!isTerminal(it.status) && (it.breached ? (
          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/40">breached</span>
        ) : (
          <span className="font-mono text-[9px] tabular-nums px-1.5 py-0.5 rounded" style={{ color: remaining <= 30 ? "#EF4444" : "#9FB2CC", background: "rgba(255,255,255,0.04)" }}>{fmt(Math.max(0, remaining))}</span>
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
        <div key={ev.label} className="mt-3" role="group" aria-label={`Evidence, ${ev.label}`}>
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
        <div className="flex items-center gap-2 mt-4" role="group" aria-label="Lifelines">
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
                <span className="ml-auto font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded tabular-nums" style={{ color: tColor, background: `${tColor}1f`, border: `1px solid ${tColor}40` }} title="Wrong moves are limited. Run out and the item locks." aria-label={`${triesLeft} tr${triesLeft === 1 ? "y" : "ies"} left`}>
                  {triesLeft} tr{triesLeft === 1 ? "y" : "ies"} left
                </span>
              );
            })()}
          </div>
          <div className="grid gap-2" role="group" aria-label={`Choose your move. Goal, ${item.goal}`} onKeyDown={onGroupArrowKeys}>
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

/* ───────────────────── coach marks (guided first shift) ───────────────────── */

// A calm, one time tip shown the first time the player opens each kind of ticket
// (a terminal ticket, a phone call, a phishing email, a stockroom order, a major
// incident). The seen state lives in localStorage (see lib/liondesk/coachmarks),
// so each tip fires at most once ever. It never blocks play: it is an inline,
// dismissible status banner, not a modal, and it grants nothing. The entrance
// animation snaps to its final state under prefers-reduced-motion.
function CoachMarkTip({ item }: { item: ShiftItem }) {
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [mark, setMark] = useState<CoachMarkDef | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    // Track the OS setting live so toggling it mid session is picked up, not just
    // on the next ticket open. Behavior preserving: the initial value still comes
    // from mq.matches on mount.
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // When this item is opened, surface the first coach mark for its surface that
  // the player has not seen and persist it as seen in one pass, so it never fires
  // again. Reading the seen state touches localStorage, so it is gated behind
  // `mounted`: nothing renders before the client knows the seen state, so there
  // is no flash.
  useEffect(() => {
    if (!mounted) return;
    const next = takeNextCoachMark(item);
    if (next) {
      setMark(next);
      setDismissed(false);
    } else {
      setMark(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, item.id]);

  if (!mounted || !mark || dismissed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-3 mb-1 rounded-xl border p-3"
      style={{
        borderColor: "rgba(74,144,217,0.4)",
        background: "linear-gradient(135deg, rgba(74,144,217,0.10) 0%, rgba(168,85,247,0.06) 100%)",
        animation: reduced ? undefined : "ld-toast-in 260ms ease-out both",
      }}
    >
      <div className="flex items-start gap-2.5">
        <Compass size={18} weight="fill" color="#4A90D9" aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-electric/80">First time tip</span>
            <span className="font-bebas text-base text-cream tracking-wide leading-none">{mark.title}</span>
          </div>
          <p className="text-cream/75 text-xs leading-relaxed mt-1">{mark.body}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss tip"
          className="ml-auto shrink-0 grid h-5 w-5 place-items-center rounded text-cream/40 hover:text-cream/80 hover:bg-white/[0.06] transition-colors"
        >
          <X size={12} weight="bold" aria-hidden="true" />
        </button>
      </div>
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
        <>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/45" aria-hidden="true">Caller patience</span>
            <span className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/10" role="progressbar" aria-valuenow={Math.round(patience)} aria-valuemin={0} aria-valuemax={100} aria-label="Caller patience">
              <span className="block h-full transition-[width] duration-500" style={{ width: `${patience}%`, background: pColor }} />
            </span>
            <span className="font-mono text-[10px] tabular-nums" style={{ color: pColor }} aria-hidden="true">{Math.round(patience)}%</span>
          </div>
          {/* Urgent-only: spoken once when patience crosses into the danger zone. */}
          <span className="sr-only" aria-live="assertive">{patience < 30 ? "Caller patience is critically low." : ""}</span>
        </>
      )}
      <div className="space-y-2" role="log" aria-live="polite" aria-label="Call transcript">
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
      <div ref={scrollRef} className="max-h-32 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-0.5 mb-2" role="log" aria-live="polite" aria-label="Terminal output">
        {lines.map((l, i) => <div key={i} className={l.tone === "in" ? "text-electric" : "text-cream/75 whitespace-pre-wrap"}>{l.text}</div>)}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-electric" aria-hidden="true">$</span>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="run a command..." aria-label="Terminal command input" spellCheck={false} className="flex-1 bg-transparent font-mono text-[11px] text-cream placeholder:text-cream/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 rounded-sm" />
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
    <div className="absolute bottom-3 right-3 left-3 sm:left-auto sm:w-80 space-y-2 pointer-events-none z-30" role="log" aria-live="polite" aria-atomic="false" aria-label="Notifications">
      {visible.map((f) => (
        <div key={f.seq} className="rounded-lg border bg-[#0a0f1c]/95 backdrop-blur px-3 py-2 text-xs leading-snug shadow-lg" style={{ borderColor: `${color(f.tone)}55`, color: "#E7EEFA", animation: "ld-toast-life 4200ms ease-out forwards" }}>
          <span style={{ color: color(f.tone) }}>{f.tone === "good" ? "✓ " : f.tone === "bad" ? "✕ " : "› "}</span>{f.text}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── shift report ───────────────────────── */

// Build a replay link for the shift on screen. A generated Surprise shift carries
// its seed in the id (generate.ts sets `surprise-<seed>`), so we rebuild the same
// shareable seed code the share control above the desk uses for a rolled run: the
// mutators come from the seed (chaos when three or more rolled), so for the rolled
// path (surprise, daily, weekly, chaos) the code is byte for byte what
// PlayGeneratedShift would produce. A hand picked Shared Combo (opened via
// ?combo=) also lands on a `surprise-<seed>` id but applied its mutators verbatim,
// so the rolled encoding here is only best effort for it until idea 30 passes an
// exact code. A curated campaign shift has no seed, so we fall back to its track
// page. Client only (reads window.location.origin); the report only ever renders
// after a shift ends, never during SSR, so window is always present here.
function replayUrlForShift(shift: Shift): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location.origin;
  const m = /^surprise-(\d+)$/.exec(shift.id);
  if (m) {
    const seed = Number(m[1]) >>> 0;
    const chaos = (shift.modifiers?.length ?? 0) >= 3;
    const code = encodeCombo({ count: 6, modifierIds: [], seed, rolled: true, chaos });
    if (code) return `${origin}/learn/techhub/surprise?seed=${code}`;
  }
  return `${origin}/learn/techhub/${shift.track}`;
}

// Idea 26: a shareable result card. Renders a static PNG (see lib/liondesk/
// shareCard) summarizing the shift and offers a download plus a copy of the
// replay link. It lives inside the focus trapped report dialog, so both controls
// are reachable by keyboard without breaking the trap (they are ordinary buttons
// the trap already enumerates). The image is static, so it is reduced motion
// safe, and it grants nothing: the Fangs it prints are the same preview number
// the report shows. No backend, web only.
function ShareResultCard({ shift, grade, score, csat, fangs, resolved, total, difficultyLabel }: { shift: Shift; grade: string; score: number; csat: number; fangs: number; resolved: number; total: number; difficultyLabel: string }) {
  const [status, setStatus] = useState("");
  const statusTimer = useRef<number | null>(null);

  function flash(msg: string) {
    setStatus(msg);
    if (statusTimer.current) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(""), 3200);
  }
  useEffect(() => () => { if (statusTimer.current) window.clearTimeout(statusTimer.current); }, []);

  function buildData(): ShareCardData {
    // A `surprise-<seed>` id can come from a rolled run (replayable byte for byte
    // from the seed) or from a hand picked Shared Combo opened via ?combo=, which
    // applies its mutators verbatim and so does not reproduce exactly from the seed
    // alone. The two are indistinguishable from the Shift object here, so the card
    // says "Replay this shift" (true for both) rather than promising "exact" for a
    // case it cannot guarantee. Idea 30 can pass an exact code prop and restore the
    // exact wording once the comboCode path is reproducible.
    const hasSeed = /^surprise-\d+$/.test(shift.id);
    return {
      trackLabel: getTrack(shift.track)?.name ?? shift.track,
      shiftName: shift.name,
      grade,
      score,
      csat,
      fangs,
      resolved,
      total,
      difficultyLabel,
      accent: shift.accent ?? "#4A90D9",
      replayLabel: hasSeed ? "Replay this shift" : "Train on the TechHub career tracks",
    };
  }

  function save() {
    // No busy guard: the download is idempotent, so a double click just re saves
    // the same file. A guard set true then false in the same synchronous call would
    // never render disabled (React batches it), so it would be dead state.
    try {
      const data = buildData();
      // A synchronous data URL keeps the download inside the click gesture so it
      // is never blocked (some browsers drop a programmatic download issued after
      // an await). The temporary anchor is hidden and removed at once, so it never
      // shows and cannot enter the dialog focus trap.
      const dataUrl = renderShareCardDataUrl(data);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = shareCardFilename(data);
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      flash("Result card saved to your downloads.");
      // Best effort: also copy the PNG to the clipboard where supported. A failure
      // is silent, the download already gave a reliable path on every browser.
      if (typeof window !== "undefined" && "ClipboardItem" in window && navigator.clipboard?.write) {
        renderShareCardBlob(data)
          .then((blob) => navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]))
          .then(() => flash("Result card saved and copied to your clipboard."))
          .catch(() => {});
      }
    } catch {
      flash("Could not build the card. Try again.");
    }
  }

  function copyLink() {
    const url = replayUrlForShift(shift);
    if (!url || !navigator.clipboard?.writeText) { flash("Copy is not available here."); return; }
    navigator.clipboard.writeText(url)
      .then(() => flash("Replay link copied. Paste it anywhere to share."))
      .catch(() => flash("Could not copy the link."));
  }

  return (
    <div className="mb-4 rounded-xl border border-gold/20 bg-gold/[0.04] p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <ImageSquare size={14} weight="fill" color="#FFD700" aria-hidden="true" />
        <p className="font-mono text-[10px] uppercase tracking-wider text-gold">Share result card</p>
      </div>
      <p className="text-cream/55 text-[11px] leading-relaxed mb-2.5">
        Save a card with your grade, score, and a Fangs preview, plus a link to replay this shift. The card is an image, nothing is granted.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gold/40 text-gold text-[11px] hover:bg-gold/10 transition-colors">
          <DownloadSimple size={13} weight="bold" aria-hidden="true" /> Save image
        </button>
        <button type="button" onClick={copyLink} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-cream/80 text-[11px] hover:bg-white/[0.06] transition-colors">
          <LinkSimple size={13} weight="bold" aria-hidden="true" /> Copy replay link
        </button>
      </div>
      <p role="status" aria-live="polite" className="font-mono text-[10px] text-cream/50 mt-2 min-h-[1.2em]">{status}</p>
    </div>
  );
}

function ShiftReport({ shift, state, onReplay, onExit, bankedFangs, bankPending }: { shift: Shift; state: State; onReplay?: () => void; onExit?: () => void; bankedFangs?: number | null; bankPending?: boolean }) {
  const live = shift.items.filter((i) => isLive(i, state.items));
  const resolved = live.filter((i) => ["resolved", "escalated", "archived", "reported"].includes(state.items[i.id].status));
  const fumbled = live.filter((i) => state.items[i.id].status === "mishandled");
  const open = live.filter((i) => state.items[i.id].status === "queued");
  const breaches = live.filter((i) => state.items[i.id].breached).length;
  const { score, grade, payoutFactor, usedLifeline } = computeResult(shift, state);
  const gradeColor = grade === "S" || grade === "A" ? "#2BBE6B" : grade === "B" ? "#4A90D9" : grade === "C" ? "#F59E0B" : "#EF4444";
  // The report is the actionable surface at shift end, so focus moves into it and
  // is trapped until the player chooses Run it back or Back. Focus returns to
  // wherever it was on dismiss.
  const dialogRef = useDialogFocus();

  // The teaching content lives in each action's `teach`. During a shift it only
  // flashes in a 4.2s toast, so the report is where the lesson actually lands:
  // every item shows the correct move and why, and a fumble shows the contrast
  // between what the player picked and what they should have.
  const correctActionOf = (i: ShiftItem) => i.actions.find((act) => act.correct) ?? null;
  const chosenActionOf = (i: ShiftItem) => {
    const cid = state.items[i.id].chosenActionId;
    return cid ? i.actions.find((act) => act.id === cid) ?? null : null;
  };

  // Real world skills: which support concepts this shift exercised, derived from
  // the concept taxonomy over the live items, plus which ones the player handled
  // cleanly (every item of that concept resolved well, none fumbled). Pure client
  // derivation over per-item correctness already in scope. Grants nothing, reads
  // no localStorage or server value, so there is no flash-of-zero to guard.
  const skillRows = (() => {
    const tally = new Map<string, { good: number; bad: number }>();
    for (const i of live) {
      const c = conceptForItem(i);
      const cur = tally.get(c) ?? { good: 0, bad: 0 };
      const st = state.items[i.id].status;
      if (GOOD_STATUSES.includes(st)) cur.good += 1;
      else if (st === "mishandled") cur.bad += 1;
      tally.set(c, cur);
    }
    return CONCEPTS.filter((def) => tally.has(def.id)).map((def) => {
      const t = tally.get(def.id)!;
      return { def, nailed: t.good > 0 && t.bad === 0 };
    });
  })();
  const nailedSkills = skillRows.filter((r) => r.nailed);

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ld-report-title" tabIndex={-1} className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#0a0f1c] p-6 max-h-[90vh] overflow-y-auto focus:outline-none">
        <div className="flex items-center gap-3 mb-4">
          <Trophy size={28} weight="fill" color={gradeColor} aria-hidden="true" />
          <div>
            <h3 id="ld-report-title" className="font-bebas text-2xl text-cream tracking-wide leading-none">Shift complete</h3>
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

        {/* Payout weight: a preview-only mirror of how the server weights this
            shift's Fang ceiling for how it was played (difficulty, a clean clear
            with no lifelines, and the best streak), as a percent of the ceiling.
            Display only, it grants nothing (the economy stays
            server-authoritative). Derived from pure engine state, so it never
            flashes a zero. */}
        <div className="mb-4 rounded-lg border border-gold/15 bg-gold/[0.04] px-3 py-2">
          <div className="flex items-center gap-2">
            <Lightning size={13} weight="fill" color="#FFD700" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-cream/55">payout weight</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-gold">{Math.round(payoutFactor * 100)}%</span>
          </div>
          <p className="font-mono text-[9px] text-cream/40 leading-relaxed mt-1">
            How {DIFF[state.difficulty].label} difficulty{usedLifeline ? "" : ", a clean clear,"} and your best streak weight the Fangs you can earn. A preview only (the server owns the real, clamped grant).
          </p>
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

        <ShiftReplay shift={shift} state={state} />

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

        {skillRows.length > 0 && (
          <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
            <div className="flex items-center gap-2 mb-1">
              <IdentificationBadge size={14} weight="fill" color="#A855F7" aria-hidden="true" />
              <p className="font-mono text-[10px] uppercase tracking-wider text-purple-300">Real-world skills</p>
            </div>
            <p className="text-cream/55 text-[11px] leading-relaxed mb-2.5">This shift maps to real certification objectives and on the job skills.</p>
            <ul className="space-y-2">
              {skillRows.map(({ def, nailed }) => (
                <li
                  key={def.id}
                  className="rounded-lg border p-2.5"
                  style={nailed ? { borderColor: "rgba(255,215,0,0.3)", background: "rgba(255,215,0,0.04)" } : { borderColor: "rgba(255,255,255,0.07)" }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-cream/90 text-xs font-semibold">{def.label}</span>
                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-electric/10 text-electric/80 border border-electric/25">{def.cert}</span>
                    {nailed && <CheckCircle size={13} weight="fill" color="#2BBE6B" className="ml-auto shrink-0" aria-hidden="true" />}
                  </div>
                  <p className="text-cream/60 text-[11px] leading-relaxed mt-1">{def.realWorld}</p>
                </li>
              ))}
            </ul>
            {nailedSkills.length > 0 && (
              <p className="text-cream/80 text-[11px] leading-relaxed mt-2.5">
                <span className="text-gold font-semibold">What you nailed:</span> you handled {joinNames(nailedSkills.map((r) => r.def.label))} cleanly this shift. {nailedSkills.length === 1 ? "That skill is" : "Those skills are"} exactly what the desk is built on.
              </p>
            )}
          </div>
        )}

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

        <ShareResultCard shift={shift} grade={grade} score={score} csat={state.csat} fangs={state.fangs} resolved={resolved.length} total={live.length} difficultyLabel={DIFF[state.difficulty].label} />

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
    </ModalPortal>
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

/* ───────────────────── shift replay scrubber ───────────────────── */

// A dismissible "walk the shift back" scrubber on the shift report. It steps
// through buildReplayTimeline (the resolved and mishandled items in the order
// the shift unfolded) one decision at a time, re-showing each move and its
// teach note so the lesson lands a second time. Pure engine state: it grants
// nothing and reads no localStorage or server value, so there is no flash of a
// zero to guard. Keyboard operable (prev and next buttons plus a native range
// slider, all reached through the report's focus trap) and reduced motion safe
// (the per step crossfade is dropped when the OS asks for reduced motion). It
// sits inline in the report scroll flow above the action buttons, so it never
// blocks Run it back or Back.
function ShiftReplay({ shift, state }: { shift: Shift; state: State }) {
  // Built once from the final state. shift and state are frozen at shift end, so
  // this never recomputes mid review.
  const timeline = useMemo(() => buildReplayTimeline(shift, state), [shift, state]);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // Initialize from matchMedia so the very first painted frame already respects
  // the setting (mirrors SettingsPanel). SSR safe via the typeof window guard.
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (dismissed || timeline.length === 0) return null;
  const total = timeline.length;
  const safeIdx = Math.max(0, Math.min(idx, total - 1));
  const d: ReplayDecision = timeline[safeIdx];
  const go = (n: number) => setIdx(Math.max(0, Math.min(total - 1, n)));
  const verdict = d.correct ? "#2BBE6B" : "#EF4444";

  return (
    <div className="mb-4 rounded-xl border border-electric/25 bg-electric/[0.05] p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <Compass size={13} weight="fill" color="#4A90D9" aria-hidden="true" />
        <p className="font-mono text-[10px] uppercase tracking-wider text-electric">Shift replay</p>
        <span className="font-mono text-[10px] tabular-nums text-cream/45 ml-1">{safeIdx + 1} / {total}</span>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss shift replay" className="ml-auto grid h-5 w-5 place-items-center rounded text-cream/40 hover:text-cream/80 hover:bg-white/[0.06] transition-colors">
          <X size={12} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <p className="text-cream/55 text-[11px] leading-relaxed mb-2.5">Walk your shift back, decision by decision. Step through with the arrows or the slider.</p>

      {/* The decision card, re-keyed so the crossfade plays per step. The fade is
          dropped under reduced motion (the content still swaps instantly). */}
      <div key={safeIdx} style={{ animation: reduced ? undefined : "ld-toast-in 200ms ease-out both" }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ color: STATUS_COLOR[d.status], background: `${STATUS_COLOR[d.status]}1f` }}>{STATUS_LABEL[d.status]}</span>
          <span className="text-cream/90 text-xs font-semibold truncate">{d.subject}</span>
          {d.correct
            ? <CheckCircle size={14} weight="fill" color="#2BBE6B" className="ml-auto shrink-0" aria-hidden="true" />
            : <span className="ml-auto shrink-0 font-bold text-sm" style={{ color: "#EF4444" }} aria-hidden="true">✕</span>}
        </div>
        {d.actionLabel ? (
          <p className="text-cream/75 text-[11px] leading-relaxed mt-1.5"><span className="font-semibold" style={{ color: verdict }}>You picked:</span> {d.actionLabel}.</p>
        ) : d.correct ? (
          <p className="text-cream/65 text-[11px] leading-relaxed mt-1.5">Resolved automatically when you fixed the incident root.</p>
        ) : (
          <p className="text-cream/65 text-[11px] leading-relaxed mt-1.5">No fix was committed on this one before it ran out.</p>
        )}
        {d.teach && <p className="text-cream/75 text-[11px] leading-relaxed mt-1">{d.teach}</p>}
        {!d.correct && d.correctLabel && (
          <p className="text-cream/75 text-[11px] leading-relaxed mt-1"><span className="text-[#2BBE6B] font-semibold">Right move:</span> {d.correctLabel}.{d.correctTeach ? ` ${d.correctTeach}` : ""}</p>
        )}
      </div>

      {/* Step controls: prev and next buttons plus a slider, all keyboard operable. */}
      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => go(safeIdx - 1)}
          disabled={safeIdx === 0}
          aria-label="Previous decision"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/15 text-cream/70 hover:bg-white/[0.06] hover:text-cream transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
        >
          <CaretLeft size={14} weight="bold" aria-hidden="true" />
        </button>
        <input
          type="range"
          min={1}
          max={total}
          step={1}
          value={safeIdx + 1}
          onChange={(e) => go(Number(e.target.value) - 1)}
          aria-label={`Decision ${safeIdx + 1} of ${total}`}
          className="flex-1 min-w-0 cursor-pointer"
          style={{ accentColor: "#4A90D9" }}
        />
        <button
          type="button"
          onClick={() => go(safeIdx + 1)}
          disabled={safeIdx >= total - 1}
          aria-label="Next decision"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/15 text-cream/70 hover:bg-white/[0.06] hover:text-cream transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
        >
          <CaretRight size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>

      {/* Polite announcement so the step change is heard by a screen reader. */}
      <span className="sr-only" aria-live="polite">
        Decision {safeIdx + 1} of {total}. {d.subject}. {d.correct ? "Handled cleanly." : "Mishandled."}
      </span>
    </div>
  );
}
