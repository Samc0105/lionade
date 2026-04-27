"use client";

import { useEffect, useRef, useState } from "react";
import { Lightning, X, Pause, Play, Coffee, Trophy, Coin, ShareNetwork } from "@phosphor-icons/react";
import { apiPost } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { useIdleAttention } from "@/lib/use-idle-attention";
import { mutateUserStats } from "@/lib/hooks";
import { toastInfo, toastError } from "@/lib/toast";
import Confetti from "@/components/Confetti";
import ShareCard from "@/components/ShareCard";

/**
 * Focus Lock-In — sealed Pomodoro session.
 *
 *   - Pick 25 / 45 / 60 minutes.
 *   - Big timer overlay; navigation across the app stays normal but the
 *     timer floats persistently in the corner.
 *   - On completion: reward modal with Fang chest reveal.
 *   - Bailing early just dismisses (no reward, no penalty — the honor
 *     system; the abuse cap is server-side).
 *
 * The actual time-tracking is requestAnimationFrame-based and tolerant
 * of tab-switches (Date.now() drives the countdown, not setInterval —
 * so backgrounded tabs don't drift).
 */

const PRESETS = [
  { duration: 25, label: "25 min", reward: 25, blurb: "Standard pomodoro" },
  { duration: 45, label: "45 min", reward: 50, blurb: "Deeper focus + bonus" },
  { duration: 60, label: "60 min", reward: 75, blurb: "Hour grind, max reward" },
] as const;

type Phase =
  | { kind: "idle" }
  | { kind: "running"; duration: number; startedAt: number }
  | { kind: "completed"; duration: number; coinsEarned: number };

export default function FocusLockIn() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const { attentioned, bind } = useIdleAttention(10_000);

  if (!user?.id) return null;

  const isRunning = phase.kind === "running";
  // Active timers stay fully visible — the user needs to see the count.
  const dim = !attentioned && !isRunning;

  return (
    <>
      {/* Floating launcher — stacks above the Quick Note pill. Hidden on
          smallest screens to avoid crowding mobile bottom nav. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={isRunning ? "View focus timer" : "Start focus session"}
        {...bind}
        style={{
          opacity: dim ? 0.4 : 1,
          filter: dim ? "blur(0.6px)" : "none",
        }}
        className={`
          fixed z-30 right-4 md:right-6
          bottom-[210px] md:bottom-[184px]
          hidden sm:inline-flex items-center gap-1.5
          rounded-full px-3 py-2
          font-mono text-[10px] uppercase tracking-[0.22em]
          transition-[opacity,filter,background-color,border-color] duration-500 ease-out active:scale-[0.97]
          shadow-lg shadow-black/30 backdrop-blur-md
          ${isRunning
            ? "bg-electric/[0.18] border border-electric/50 text-cream"
            : "bg-white/[0.04] border border-white/[0.1] text-cream/70 hover:text-cream hover:bg-white/[0.08] hover:border-white/[0.2]"
          }
        `}
      >
        <Lightning size={12} weight={isRunning ? "fill" : "bold"} />
        <span>
          {isRunning
            ? <RemainingClock startedAt={phase.startedAt} duration={phase.duration} />
            : "Lock in"}
        </span>
      </button>

      {open && phase.kind === "idle" && (
        <PickerPanel
          onClose={() => setOpen(false)}
          onStart={(duration) => {
            setPhase({ kind: "running", duration, startedAt: Date.now() });
            setOpen(false);
            toastInfo(`Locked in for ${duration} minutes. No fangs lost if you bail — just the bonus.`);
          }}
        />
      )}

      {phase.kind === "running" && (
        <RunningTimer
          duration={phase.duration}
          startedAt={phase.startedAt}
          visible={open}
          onMinimize={() => setOpen(false)}
          onAbort={() => { setPhase({ kind: "idle" }); setOpen(false); }}
          onComplete={async () => {
            // Hit the server to claim the reward, then transition to
            // the completed phase so the celebration modal renders.
            try {
              type R = { ok: boolean; coinsEarned: number; reason?: string; message?: string };
              const r = await apiPost<R>("/api/focus-session", { durationMinutes: phase.duration });
              const coinsEarned = r.ok && r.data?.ok ? r.data.coinsEarned : 0;
              if (r.ok && !r.data?.ok && r.data?.message) toastError(r.data.message);
              setPhase({ kind: "completed", duration: phase.duration, coinsEarned });
              if (user?.id) mutateUserStats(user.id);
            } catch (e) {
              toastError((e as Error).message);
              setPhase({ kind: "idle" });
            }
            setOpen(true);
          }}
        />
      )}

      {phase.kind === "completed" && (
        <CompletionModal
          duration={phase.duration}
          coinsEarned={phase.coinsEarned}
          onClose={() => { setPhase({ kind: "idle" }); setOpen(false); }}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline countdown clock for the floating button.
// ─────────────────────────────────────────────────────────────────────────────
function RemainingClock({ startedAt, duration }: { startedAt: number; duration: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, startedAt + duration * 60_000 - now);
  const m = Math.floor(remainingMs / 60_000);
  const s = Math.floor((remainingMs % 60_000) / 1000);
  return <>{m.toString().padStart(2, "0")}:{s.toString().padStart(2, "0")}</>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Picker — appears when user clicks "Lock in" with no session running.
// ─────────────────────────────────────────────────────────────────────────────
function PickerPanel({
  onClose, onStart,
}: {
  onClose: () => void;
  onStart: (duration: number) => void;
}) {
  return (
    <div
      className="fixed z-30 right-4 md:right-6 bottom-[260px] md:bottom-[230px]
        w-[300px] rounded-[12px] border border-white/[0.1] bg-navy/95 backdrop-blur-md
        shadow-2xl shadow-black/40 p-4 animate-slide-up"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Lightning size={13} className="text-electric" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-electric">
            Lock In
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid place-items-center w-6 h-6 rounded-full hover:bg-white/[0.06] text-cream/40 hover:text-cream"
        >
          <X size={11} weight="bold" />
        </button>
      </div>
      <p className="text-[12.5px] text-cream/65 mb-3 leading-snug">
        Pick a session length. Finish it, get the Fang chest. Bail early — no penalty, no bonus.
      </p>
      <ul className="flex flex-col gap-2">
        {PRESETS.map(p => (
          <li key={p.duration}>
            <button
              type="button"
              onClick={() => onStart(p.duration)}
              className="w-full flex items-center gap-3 rounded-[8px] px-3 py-2.5
                bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-electric/40
                transition-colors text-left"
            >
              <div className="grid place-items-center w-9 h-9 rounded-full bg-electric/[0.15] text-electric shrink-0">
                <Lightning size={14} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-syne font-semibold text-[14px] text-cream">{p.label}</span>
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
                    <Coin size={10} weight="fill" /> +{p.reward}F
                  </span>
                </div>
                <p className="text-[11.5px] text-cream/50 leading-snug">{p.blurb}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <p className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-cream/30 text-center mt-3">
        Cap: 6 sessions per day
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Running timer — full-screen modal that the user can dismiss to keep
// the session running in the background (the floating chip shows the
// countdown). Auto-completes when the timer hits zero.
// ─────────────────────────────────────────────────────────────────────────────
function RunningTimer({
  duration, startedAt, visible, onMinimize, onAbort, onComplete,
}: {
  duration: number;
  startedAt: number;
  visible: boolean;
  onMinimize: () => void;
  onAbort: () => void;
  onComplete: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const completedRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const totalMs = duration * 60_000;
  const elapsedMs = Math.min(totalMs, now - startedAt);
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const progress = elapsedMs / totalMs;

  // Trigger completion exactly once when the timer finishes.
  useEffect(() => {
    if (remainingMs === 0 && !completedRef.current) {
      completedRef.current = true;
      onComplete();
    }
  }, [remainingMs, onComplete]);

  if (!visible) return null;

  const m = Math.floor(remainingMs / 60_000);
  const s = Math.floor((remainingMs % 60_000) / 1000);

  // Confirm before bailing — Sam doesn't want students to lose their
  // bonus by accidentally tapping "End".
  const handleAbort = () => {
    if (confirm("End the session early? You'll lose this session's Fang bonus.")) {
      onAbort();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/80 backdrop-blur-md px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Focus session in progress"
    >
      <div className="relative w-full max-w-md rounded-[18px] border border-electric/40 bg-gradient-to-br from-navy to-[#0a0f1d] p-7 shadow-2xl shadow-electric/20 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Lightning size={13} className="text-electric" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-electric">
            Locked in · {duration} min
          </span>
        </div>

        {/* Big circular progress + countdown */}
        <div className="relative w-[200px] h-[200px] mx-auto mb-4">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle
              cx="50" cy="50" r="46" fill="none"
              stroke="rgba(255,255,255,0.08)" strokeWidth="3"
            />
            <circle
              cx="50" cy="50" r="46" fill="none"
              stroke="#4A90D9" strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 46}
              strokeDashoffset={2 * Math.PI * 46 * (1 - progress)}
              style={{ transition: "stroke-dashoffset 0.25s linear" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div>
              <div className="font-bebas text-[56px] tracking-tight tabular-nums text-cream leading-none">
                {m.toString().padStart(2, "0")}:{s.toString().padStart(2, "0")}
              </div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/40 mt-1">
                {Math.round(progress * 100)}%
              </div>
            </div>
          </div>
        </div>

        <p className="text-[13px] text-cream/65 mb-5 leading-relaxed">
          Phone down. Tabs closed. The Fang chest unlocks at zero.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onMinimize}
            className="flex-1 rounded-full border border-white/[0.15] text-cream/80 hover:text-cream hover:border-white/[0.3]
              font-mono text-[10px] uppercase tracking-[0.25em] py-2.5 transition-colors"
          >
            Minimize
          </button>
          <button
            type="button"
            onClick={handleAbort}
            className="flex-1 rounded-full border border-[#EF4444]/30 text-[#EF4444]/80 hover:text-[#EF4444] hover:border-[#EF4444]/50
              font-mono text-[10px] uppercase tracking-[0.25em] py-2.5 transition-colors"
          >
            End early
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Completion modal — Fang chest reveal.
// ─────────────────────────────────────────────────────────────────────────────
function CompletionModal({
  duration, coinsEarned, onClose,
}: {
  duration: number;
  coinsEarned: number;
  onClose: () => void;
}) {
  const [confettiOn, setConfettiOn] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setConfettiOn(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4 cursor-pointer"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <Confetti
        trigger={confettiOn}
        count={80}
        origin="center"
        palette={["#FFD700", "#F0B429", "#4A90D9", "#22C55E"]}
        duration={1800}
      />
      <div
        className="relative rounded-[18px] border border-gold/40 bg-gradient-to-br from-[#1a1812] via-navy to-[#0a0f1d]
          px-8 py-7 shadow-2xl shadow-gold/30 animate-slide-up
          flex flex-col items-center text-center min-w-[280px]"
        onClick={(e) => e.stopPropagation()}
      >
        <Trophy size={42} weight="fill" className="text-gold mb-3" />
        <h3 className="font-bebas text-[36px] tracking-wider text-cream leading-none mb-1">
          LOCKED IN
        </h3>
        <p className="text-cream/60 text-[13px] mb-4">
          {duration} minutes. Real focus.
        </p>

        {coinsEarned > 0 ? (
          <div className="inline-flex items-center gap-2 rounded-full bg-gold/[0.12] border border-gold/40 px-4 py-1.5 mb-4">
            <Coin size={14} weight="fill" className="text-gold" />
            <span className="font-bebas text-[28px] tabular-nums text-gold tracking-wider leading-none">
              +{coinsEarned}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold/80">Fangs</span>
          </div>
        ) : (
          <p className="text-cream/50 text-[12px] mb-4">
            (Daily session cap hit — bonus skipped, but the focus still counts.)
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 w-full">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
            className="rounded-full border border-gold/40 text-gold hover:bg-gold/10
              font-mono text-[11px] uppercase tracking-[0.25em] py-3 transition-colors
              inline-flex items-center justify-center gap-1.5"
          >
            <ShareNetwork size={11} weight="fill" /> Share
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-electric text-white hover:bg-electric/90
              font-mono text-[11px] uppercase tracking-[0.25em] py-3 transition-colors
              inline-flex items-center justify-center gap-1.5"
          >
            <Coffee size={12} weight="fill" /> Take a break
          </button>
        </div>
        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/30 mt-3">
          Tap anywhere to dismiss
        </p>

        <ShareCard
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          shareTitle={`focus-${duration}min`}
          card={{
            headline: "FOCUS LOCK-IN",
            subline: `${duration} minutes deep work`,
            bigNumber: { value: `+${coinsEarned}`, label: "Fangs earned" },
            stats: [
              { label: "Duration", value: `${duration}m` },
              { label: "Status", value: "Locked in" },
            ],
            accent: "#4A90D9",
          }}
        />
      </div>
    </div>
  );
}
