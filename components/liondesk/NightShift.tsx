"use client";

import { useEffect, useReducer, useRef, useState, type Dispatch } from "react";
import Link from "next/link";
import {
  Monitor, VideoCamera, ShieldWarning, Pulse, Warning, Moon, Lightning,
  SpeakerHigh, SpeakerSlash, ArrowClockwise,
} from "@phosphor-icons/react";
import { FEEDS, NIGHT, hourLabel, type Feed, type FeedKind } from "@/lib/liondesk/nightshift";
import {
  startAmbient, stopAmbient, setAmbientTension, playAlarm, playContain, playStinger,
  playWin, resumeAudio, isMuted, setMuted,
} from "@/lib/liondesk/sound";

/* ───────────────────────── state ───────────────────────── */

type Status = "idle" | "playing" | "won" | "lost";
interface NState {
  hour: number;
  secInHour: number;
  threatFeed: string;
  activeFeed: string;
  progress: number;
  timer: number;
  status: Status;
  containments: number;
  advanceCount: number;
  flicker: number;
}

type NAction = { t: "START" } | { t: "TICK" } | { t: "SELECT"; feed: string } | { t: "CONTAIN" } | { t: "RESET" };

function makeInit(): NState {
  return {
    hour: 0, secInHour: 0,
    threatFeed: NIGHT.startThreatFeed, activeFeed: NIGHT.startActiveFeed,
    progress: 0, timer: NIGHT.advanceSeconds[0], status: "idle",
    containments: 0, advanceCount: 0, flicker: 0,
  };
}

function pickFeed(exclude: string): string {
  const opts = FEEDS.filter((f) => f.id !== exclude);
  return opts[Math.floor(Math.random() * opts.length)].id;
}
function advanceSecondsFor(hour: number): number {
  return NIGHT.advanceSeconds[Math.min(hour, NIGHT.advanceSeconds.length - 1)];
}

function reducer(s: NState, a: NAction): NState {
  switch (a.t) {
    case "START":
      return { ...makeInit(), status: "playing" };
    case "RESET":
      return makeInit();
    case "SELECT":
      return s.status === "playing" ? { ...s, activeFeed: a.feed } : s;
    case "CONTAIN": {
      if (s.status !== "playing") return s;
      if (s.activeFeed !== s.threatFeed) return s; // nothing here, you wasted a beat
      return {
        ...s,
        progress: Math.max(0, s.progress - 1),
        containments: s.containments + 1,
        threatFeed: pickFeed(s.threatFeed),
        timer: advanceSecondsFor(s.hour),
      };
    }
    case "TICK": {
      if (s.status !== "playing") return s;
      let hour = s.hour;
      let secInHour = s.secInHour + 1;
      if (secInHour >= NIGHT.secondsPerHour) {
        secInHour = 0;
        hour += 1;
        if (hour >= NIGHT.hours) return { ...s, hour: NIGHT.hours, secInHour: 0, status: "won" };
      }
      let timer = s.timer - 1;
      let progress = s.progress;
      let threatFeed = s.threatFeed;
      let advanceCount = s.advanceCount;
      if (timer <= 0) {
        progress += 1;
        advanceCount += 1;
        if (progress >= NIGHT.core) return { ...s, hour, secInHour, progress: NIGHT.core, advanceCount, status: "lost" };
        threatFeed = pickFeed(threatFeed);
        timer = advanceSecondsFor(hour);
      }
      return { ...s, hour, secInHour, timer, progress, threatFeed, advanceCount, flicker: s.flicker + 1 };
    }
    default:
      return s;
  }
}

/* ───────────────────────── component ───────────────────────── */

const FEED_ICON: Record<FeedKind, typeof Monitor> = {
  logs: Pulse, cam: VideoCamera, net: Monitor, siem: ShieldWarning, edr: Warning,
};

export default function NightShift() {
  const [state, dispatch] = useReducer(reducer, undefined, makeInit);
  const [muted, setMutedState] = useState(false);
  useEffect(() => { setMutedState(isMuted()); }, []);

  const tension = state.progress / NIGHT.core;

  // Real-time clock.
  useEffect(() => {
    if (state.status !== "playing") return;
    const id = setInterval(() => dispatch({ t: "TICK" }), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  // Ambient lifecycle tied to status.
  useEffect(() => {
    if (state.status === "playing") startAmbient();
    if (state.status === "won") { stopAmbient(); playWin(); }
    if (state.status === "lost") { stopAmbient(); playStinger(); }
    return () => { if (state.status === "playing") stopAmbient(); };
  }, [state.status]);

  // Dread rises with proximity to the core.
  useEffect(() => { setAmbientTension(tension); }, [tension]);

  // Alarm + screen flash each time the threat advances.
  const prevAdvance = useRef(0);
  useEffect(() => {
    if (state.advanceCount > prevAdvance.current && state.status === "playing") playAlarm();
    prevAdvance.current = state.advanceCount;
  }, [state.advanceCount, state.status]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (next) stopAmbient();
    else if (state.status === "playing") { resumeAudio(); startAmbient(); }
  }

  const activeFeed = FEEDS.find((f) => f.id === state.activeFeed)!;
  const threatHere = state.activeFeed === state.threatFeed && state.status === "playing";
  const integrity = Math.round(100 * (1 - state.progress / NIGHT.core));
  const integrityColor = integrity >= 70 ? "#2BBE6B" : integrity >= 40 ? "#F59E0B" : "#EF4444";

  return (
    <div className="relative rounded-2xl border border-white/[0.08] overflow-hidden bg-[#04060c] select-none" style={{ boxShadow: `inset 0 0 120px rgba(239,68,68,${tension * 0.25})` }}>
      <style>{`
        @keyframes ns-flash { 0%{opacity:0.5} 100%{opacity:0} }
        @keyframes ns-blink { 0%,100%{opacity:1} 50%{opacity:0.25} }
        .ns-scan { background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px); }
      `}</style>

      {/* advance flash */}
      {state.status === "playing" && (
        <div key={state.advanceCount} className="pointer-events-none absolute inset-0 z-10" style={{ background: "radial-gradient(circle, rgba(239,68,68,0.0) 30%, rgba(239,68,68,0.35) 100%)", animation: state.advanceCount > 0 ? "ns-flash 600ms ease-out" : undefined, opacity: 0 }} />
      )}

      {/* top status */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02] flex-wrap">
        <Moon size={16} weight="fill" color="#6E8BC0" aria-hidden="true" />
        <span className="font-bebas text-sm text-cream tracking-wide">NIGHT SHIFT</span>
        <span className="font-mono text-[12px] tabular-nums" style={{ color: state.status === "playing" ? "#9FB2CC" : "#6B7280" }}>{hourLabel(state.hour)}</span>
        <div className="flex-1 min-w-[80px] max-w-[180px] h-1 rounded-full overflow-hidden bg-white/10">
          <div className="h-full bg-[#6E8BC0]" style={{ width: `${Math.min(100, ((state.hour + state.secInHour / NIGHT.secondsPerHour) / NIGHT.hours) * 100)}%` }} />
        </div>
        <span className="ml-auto flex items-center gap-2 font-mono text-[11px]">
          <span className="text-cream/45">INTEGRITY</span>
          <span className="w-14 h-1.5 rounded-full overflow-hidden bg-white/10 hidden sm:inline-block align-middle">
            <span className="block h-full" style={{ width: `${integrity}%`, background: integrityColor }} />
          </span>
          <span style={{ color: integrityColor }}>{integrity}%</span>
        </span>
        <button onClick={toggleMute} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"} className="w-7 h-7 rounded-md border border-white/15 text-cream/60 hover:bg-white/[0.06] flex items-center justify-center">
          {muted ? <SpeakerSlash size={13} weight="fill" aria-hidden="true" /> : <SpeakerHigh size={13} weight="fill" aria-hidden="true" />}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] min-h-[440px]">
        {/* feed selector (the "cameras") */}
        <div className="border-r border-white/[0.06] p-2.5 space-y-1.5 bg-white/[0.012]">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/35 px-1 mb-1">feeds</p>
          {FEEDS.map((f) => {
            const Icon = FEED_ICON[f.kind];
            const active = state.activeFeed === f.id;
            return (
              <button
                key={f.id}
                onClick={() => dispatch({ t: "SELECT", feed: f.id })}
                disabled={state.status !== "playing"}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors ${active ? "border-[#2BBE6B]/60 bg-[#2BBE6B]/10" : "border-white/[0.07] hover:bg-white/[0.04]"} disabled:opacity-40`}
              >
                <Icon size={15} weight={active ? "fill" : "regular"} color={active ? "#2BBE6B" : "#9FB2CC"} aria-hidden="true" />
                <span className="font-mono text-[11px]" style={{ color: active ? "#F5EBDA" : "rgba(159,178,204,0.85)" }}>{f.short}</span>
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#2BBE6B]" style={{ animation: "ns-blink 1.4s infinite" }} />}
              </button>
            );
          })}
        </div>

        {/* the active feed */}
        <div className="relative p-4">
          <div className={`ns-scan rounded-xl border h-full min-h-[380px] p-4 flex flex-col ${threatHere ? "border-red-500/50" : "border-white/[0.08]"}`} style={{ background: threatHere ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.015)" }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-red-500" style={{ animation: "ns-blink 1s infinite" }} />
              <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-cream/60">{activeFeed.label}</span>
              <span className="ml-auto font-mono text-[10px] text-cream/30">LIVE · 0{Math.max(2, state.hour)}:{String((state.secInHour * 2) % 60).padStart(2, "0")}</span>
            </div>

            <FeedBody feed={activeFeed} threat={threatHere} flicker={state.flicker} />

            <div className="mt-auto pt-3">
              {threatHere ? (
                <button
                  onClick={() => { playContain(); dispatch({ t: "CONTAIN" }); }}
                  className="w-full min-h-[44px] rounded-xl font-bold text-sm text-[#04080F] transition-transform active:scale-[0.99]"
                  style={{ background: "linear-gradient(135deg,#EF4444,#F59E0B)" }}
                >
                  ⚠ CONTAIN: {activeFeed.containLabel}
                </button>
              ) : (
                <p className="text-center font-mono text-[11px] text-cream/30">no anomaly on this feed. keep watching the others.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* idle / won / lost overlays */}
      {state.status === "idle" && <Overlay tone="idle" dispatch={dispatch} />}
      {state.status === "won" && <Overlay tone="won" dispatch={dispatch} state={state} />}
      {state.status === "lost" && <Overlay tone="lost" dispatch={dispatch} state={state} />}
    </div>
  );
}

/* ───────────────────────── feed bodies ───────────────────────── */

function FeedBody({ feed, threat, flicker }: { feed: Feed; threat: boolean; flicker: number }) {
  const lines = threat ? feed.threat : feed.normal;
  // rotate the visible lines so the feed looks alive
  const rolled = lines.map((_, i) => lines[(i + flicker) % lines.length]);

  if (feed.kind === "cam") {
    return (
      <div className="flex-1 flex flex-col">
        {threat && <p className="font-mono text-xs text-red-400 mb-2 uppercase tracking-wider" style={{ animation: "ns-blink 0.8s infinite" }}>⚠ {feed.threatHeadline}</p>}
        <div className="flex-1 rounded-lg ns-scan flex items-center justify-center relative overflow-hidden" style={{ background: threat ? "rgba(239,68,68,0.12)" : "rgba(110,139,192,0.06)", minHeight: 160 }}>
          <div className="text-center font-mono text-[11px] leading-relaxed" style={{ color: threat ? "#FCA5A5" : "rgba(159,178,204,0.7)" }}>
            {rolled.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          {threat && <div className="absolute top-2 right-2 font-mono text-[9px] text-red-400" style={{ animation: "ns-blink 0.6s infinite" }}>● REC</div>}
        </div>
      </div>
    );
  }

  if (feed.kind === "net") {
    return (
      <div className="flex-1">
        {threat && <p className="font-mono text-xs text-red-400 mb-2 uppercase tracking-wider" style={{ animation: "ns-blink 0.8s infinite" }}>⚠ {feed.threatHeadline}</p>}
        <div className="flex flex-wrap gap-2 mb-3">
          {["GW", "CORE-DB", "FILESRV-2", "WKS-1042", "DMZ", "BACKUP"].map((n, i) => {
            const hot = threat && (i === 2 || i === 1);
            return (
              <span key={n} className="font-mono text-[10px] px-2 py-1 rounded border" style={{ color: hot ? "#FCA5A5" : "#9FB2CC", borderColor: hot ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.1)", background: hot ? "rgba(239,68,68,0.12)" : "transparent", animation: hot ? "ns-blink 0.7s infinite" : undefined }}>{n}</span>
            );
          })}
        </div>
        <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: threat ? "#FCA5A5" : "rgba(159,178,204,0.7)" }}>{rolled.join("\n")}</pre>
      </div>
    );
  }

  // logs / siem / edr
  return (
    <div className="flex-1">
      {threat && <p className="font-mono text-xs text-red-400 mb-2 uppercase tracking-wider" style={{ animation: "ns-blink 0.8s infinite" }}>⚠ {feed.threatHeadline}</p>}
      <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap" style={{ color: threat ? "#FCA5A5" : "rgba(159,178,204,0.65)" }}>
{rolled.map((l) => `${threat ? ">" : " "} ${l}`).join("\n")}
      </pre>
    </div>
  );
}

/* ───────────────────────── overlays ───────────────────────── */

function Overlay({ tone, dispatch, state }: { tone: "idle" | "won" | "lost"; dispatch: Dispatch<NAction>; state?: NState }) {
  if (tone === "idle") {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#04060c]/95 p-4">
        <div className="text-center max-w-md">
          <Moon size={40} weight="fill" color="#6E8BC0" aria-hidden="true" className="mx-auto mb-3" />
          <h3 className="font-bebas text-3xl text-cream tracking-wider">THE NIGHT SHIFT</h3>
          <p className="text-cream/60 text-sm mt-2 leading-relaxed">
            You're alone in the SOC. An intruder is moving through the systems and only shows up on the ONE feed it's on right now. Flip feeds to find it, then CONTAIN it before it reaches the core. Survive to 6 AM.
          </p>
          <p className="font-mono text-[11px] text-cream/35 mt-3">Tip: turn your sound on.</p>
          <button onClick={() => { resumeAudio(); dispatch({ t: "START" }); }} className="mt-5 px-6 py-3 min-h-[44px] rounded-xl font-bold text-sm text-[#04080F] inline-flex items-center gap-2" style={{ background: "linear-gradient(135deg,#2BBE6B,#4A90D9)" }}>
            <Lightning size={16} weight="fill" /> Clock in
          </button>
        </div>
      </div>
    );
  }

  const won = tone === "won";
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4" style={{ background: won ? "rgba(4,6,12,0.95)" : "rgba(40,0,0,0.92)" }}>
      <div className="text-center max-w-md">
        {won ? (
          <>
            <h3 className="font-bebas text-4xl tracking-wider" style={{ color: "#2BBE6B" }}>6:00 AM</h3>
            <p className="text-cream/75 text-sm mt-2">You made it through the night. The intruder never reached the core.</p>
          </>
        ) : (
          <>
            <ShieldWarning size={44} weight="fill" color="#EF4444" aria-hidden="true" className="mx-auto mb-2" style={{ animation: "ns-blink 0.5s infinite" }} />
            <h3 className="font-bebas text-5xl tracking-[0.2em]" style={{ color: "#EF4444" }}>BREACHED</h3>
            <p className="text-cream/70 text-sm mt-2">The intruder reached the core. You looked away one feed too long.</p>
          </>
        )}
        {state && (
          <p className="font-mono text-[11px] text-cream/50 mt-3">
            Reached {hourLabel(state.hour)} · {state.containments} containment{state.containments === 1 ? "" : "s"}
          </p>
        )}
        <button onClick={() => { resumeAudio(); dispatch({ t: "START" }); }} className="mt-5 px-6 py-3 min-h-[44px] rounded-xl font-bold text-sm text-[#04080F] inline-flex items-center gap-2" style={{ background: "linear-gradient(135deg,#FFD700,#FFA500)" }}>
          <ArrowClockwise size={16} weight="bold" /> Work another night
        </button>
      </div>
    </div>
  );
}
