"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { toastInfo, toastError } from "@/lib/toast";
import { mutateUserStats } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import {
  Coin, CheckCircle, Sparkle, Fire, Clock, Trophy, X, ArrowRight,
} from "@phosphor-icons/react";

/**
 * Daily check-in button with a 24h ROLLING cooldown (not calendar-day).
 *
 *   - Available: gold animated pill, click claims AND opens the history
 *     popover (so the user immediately sees their new lifetime total).
 *   - On cooldown: muted pill showing the live countdown to next claim;
 *     click opens the popover (which hosts the same countdown + lifetime
 *     stats + recent-claims log).
 *   - On claim: existing slot-machine reveal modal stays as the celebration.
 */

interface ClaimResponse {
  awarded: boolean;
  amount?: number;
  consecutiveDays?: number;
  reason?: string;
  msUntilAvailable?: number;
  nextAvailableAt?: string;
  lifetimeFangs?: number;
}

interface StatusResponse {
  available: boolean;
  msUntilAvailable: number;
  cooldownMs: number;
  nextAvailableAt: string | null;
  lastClaimAt: string | null;
  currentStreak: number;
  nextStreak: number;
  nextAmount: number;
  lifetimeFangs: number;
  totalClaims: number;
  recent: Array<{ amount: number; claimedAt: string }>;
}

export default function ClockInButton() {
  const { user } = useAuth();
  const { data, mutate } = useSWR<StatusResponse>(
    user?.id ? "/api/login-bonus" : null,
    swrFetcher,
    { revalidateOnFocus: true, refreshInterval: 60_000 },
  );

  const [submitting, setSubmitting] = useState(false);
  const [reveal, setReveal] = useState<{ amount: number; day: number } | null>(null);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Live countdown — re-renders every second so the chip + popover both
  // tick visually instead of waiting on the SWR refresh interval.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (data?.available) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [data?.available]);

  // Outside-click + Esc to close popover.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Re-trigger an SWR refresh once the cooldown actually elapses so the
  // button flips to "available" without needing a focus event.
  useEffect(() => {
    if (!data || data.available) return;
    const ms = Math.max(0, new Date(data.nextAvailableAt ?? "").getTime() - Date.now());
    if (ms === 0) { void mutate(); return; }
    const t = setTimeout(() => { void mutate(); }, ms + 250);
    return () => clearTimeout(t);
  }, [data, mutate]);

  const claim = async () => {
    if (submitting) return;
    if (data && !data.available) {
      toastInfo("Daily already claimed — come back when the timer ends.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiPost<ClaimResponse>("/api/login-bonus", {});
      if (!r.ok || !r.data) {
        toastError("Couldn't claim. Try again.");
        return;
      }
      if (r.data.awarded && r.data.amount) {
        setReveal({
          amount: r.data.amount,
          day: r.data.consecutiveDays ?? 1,
        });
        if (user?.id) mutateUserStats(user.id);
        void mutate(); // refresh status → flips to cooldown
      } else if (r.data.reason === "on_cooldown") {
        toastInfo("Daily already claimed — come back when the timer ends.");
        void mutate();
      } else {
        toastError("Couldn't claim. Try again.");
      }
    } catch {
      toastError("Couldn't claim. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user?.id) return null;

  const available = data?.available ?? false;
  const remainingMs = data
    ? Math.max(0, new Date(data.nextAvailableAt ?? "").getTime() - now)
    : 0;
  const claimed = !available && data !== undefined;

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <button
          onClick={() => {
            // Available → claim AND open popover. Cooldown → just open.
            if (available && !submitting) void claim();
            setOpen(o => !o);
          }}
          aria-label={available ? "Claim daily Fangs" : `Daily on cooldown (${formatCountdown(remainingMs)})`}
          className={`clock-in-btn ${claimed ? "clock-in-btn--claimed" : ""}`}
        >
          {claimed
            ? <>
                <span className="coin-icon"><Clock size={11} weight="bold" /></span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] tabular-nums">
                  {formatCountdownShort(remainingMs)}
                </span>
              </>
            : <>
                <span className="coin-icon"><Coin size={12} weight="fill" /></span>
                <span>{submitting ? "…" : "Daily"}</span>
              </>
          }
        </button>

        {open && data && (
          <HistoryPopover
            data={data}
            now={now}
            submitting={submitting}
            onClaim={() => void claim()}
            onClose={() => setOpen(false)}
          />
        )}
      </div>

      {reveal && (
        <ClockInReveal
          amount={reveal.amount}
          day={reveal.day}
          onClose={() => setReveal(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// History popover — anchored under the navbar button. Stats + countdown +
// recent claims, with a Claim button when available.
// ─────────────────────────────────────────────────────────────────────────────
function HistoryPopover({
  data, now, submitting, onClaim, onClose,
}: {
  data: StatusResponse;
  now: number;
  submitting: boolean;
  onClaim: () => void;
  onClose: () => void;
}) {
  const remainingMs = Math.max(0, new Date(data.nextAvailableAt ?? "").getTime() - now);

  return (
    <>
      {/* Mobile-only invisible scrim so taps outside dismiss without
          leaving a visible backdrop (would be ugly under the navbar). */}
      <div className="fixed inset-0 z-40 sm:hidden" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-label="Daily check-in details"
        className="absolute right-0 top-[calc(100%+8px)] z-50 w-[290px]
          rounded-[14px] border border-gold/30 bg-gradient-to-br from-[#13110b] via-navy to-[#0a0f1d]
          shadow-2xl shadow-gold/15 p-4 animate-slide-up"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 grid place-items-center w-6 h-6 rounded-full
            text-cream/40 hover:text-cream hover:bg-white/[0.06] transition-colors"
        >
          <X size={11} weight="bold" />
        </button>

        <div className="flex items-center gap-1.5 mb-3">
          <Sparkle size={11} className="text-gold" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            Daily check-in
          </span>
        </div>

        {/* ─── Hero state: countdown OR ready-to-claim ─── */}
        {data.available ? (
          <div className="rounded-[10px] border border-gold/30 bg-gold/[0.06] p-3 mb-3">
            <div className="flex items-baseline justify-between mb-1">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-gold/80">
                Ready now
              </span>
              <span className="font-bebas text-[22px] tracking-wider text-gold leading-none">
                +{data.nextAmount}
              </span>
            </div>
            <button
              type="button"
              onClick={onClaim}
              disabled={submitting}
              className="w-full mt-1.5 inline-flex items-center justify-center gap-1.5 rounded-full
                bg-gold text-navy hover:bg-gold/90 disabled:opacity-60
                font-syne font-bold text-[13px] py-2 transition-transform active:scale-[0.97]"
            >
              <Coin size={13} weight="fill" />
              {submitting ? "Claiming…" : `Claim ${data.nextAmount} Fangs`}
              <ArrowRight size={12} weight="bold" />
            </button>
          </div>
        ) : (
          <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.02] p-3 mb-3">
            <div className="flex items-baseline justify-between mb-1">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/55">
                Next claim in
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-cream/40">
                +{data.nextAmount} ready
              </span>
            </div>
            <div className="font-bebas text-[26px] tracking-wider text-cream tabular-nums leading-none">
              {formatCountdown(remainingMs)}
            </div>
          </div>
        )}

        {/* ─── Stat tiles ─── */}
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <StatTile
            label="Lifetime"
            value={data.lifetimeFangs.toLocaleString()}
            icon={<Coin size={11} weight="fill" />}
            accent="#FFD700"
          />
          <StatTile
            label="Streak"
            value={`${data.currentStreak}d`}
            icon={<Fire size={11} weight="fill" />}
            accent="#EF4444"
          />
          <StatTile
            label="Claims"
            value={data.totalClaims}
            icon={<Trophy size={11} weight="fill" />}
            accent="#A855F7"
          />
        </div>

        {/* ─── Recent claims log ─── */}
        {data.recent.length > 0 && (
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-cream/35 mb-1.5">
              Recent
            </p>
            <ul className="space-y-1">
              {data.recent.slice(0, 5).map((r, i) => (
                <li
                  key={r.claimedAt}
                  className="flex items-center justify-between gap-2 text-[11.5px]"
                >
                  <span className="text-cream/55 font-mono tabular-nums">
                    {timeAgo(r.claimedAt, now)}
                  </span>
                  <span className={`font-syne font-semibold tabular-nums ${i === 0 ? "text-gold" : "text-cream/70"}`}>
                    +{r.amount}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-cream/25 text-center mt-3">
          24h cooldown · escalates with streak
        </p>
      </div>
    </>
  );
}

function StatTile({
  label, value, icon, accent,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div
      className="rounded-[8px] border bg-white/[0.02] px-2 py-1.5"
      style={{ borderColor: `${accent}25` }}
    >
      <div className="flex items-center gap-1 mb-0.5" style={{ color: accent }}>
        {icon}
        <span className="font-mono text-[8.5px] uppercase tracking-[0.18em]">{label}</span>
      </div>
      <p className="font-bebas text-[16px] tracking-wider text-cream leading-none tabular-nums">
        {value}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reveal toast — slides down from top, auto-dismisses after AUTO_CLOSE_MS,
// non-blocking (no backdrop). Replaces the old center-screen modal.
// ─────────────────────────────────────────────────────────────────────────────
const AUTO_CLOSE_MS = 5000;

function ClockInReveal({
  amount, day, onClose,
}: {
  amount: number;
  day: number;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();

  // 5s auto-dismiss + Esc to close early.
  useEffect(() => {
    const t = setTimeout(onClose, AUTO_CLOSE_MS);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Animation values — skip motion when the user prefers reduced motion.
  const initial = reduceMotion ? { opacity: 0 } : { opacity: 0, y: -24 };
  const animate = reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 };
  const exit    = reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16 };

  return (
    <AnimatePresence>
      <motion.div
        key="clock-in-toast"
        initial={initial}
        animate={animate}
        exit={exit}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        role="status"
        aria-live="polite"
        aria-label={`+${amount} Fangs claimed for day ${day}`}
        className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
      >
        <div
          className="relative flex items-center gap-3 rounded-full pl-3 pr-2 py-2
            border border-gold/40
            bg-gradient-to-r from-[#15110a] via-[#1c1608] to-[#15110a]
            shadow-[0_8px_28px_-8px_rgba(255,215,0,0.45),0_0_0_1px_rgba(255,215,0,0.06)_inset]
            min-w-[260px] max-w-[92vw]"
        >
          {/* Coin icon */}
          <span
            className="shrink-0 grid place-items-center w-7 h-7 rounded-full
              bg-gradient-to-br from-[#FFD700] to-[#F0B429] text-navy
              shadow-[0_0_12px_rgba(255,215,0,0.45)]"
            aria-hidden="true"
          >
            <Coin size={14} weight="fill" />
          </span>

          {/* Amount + label */}
          <div className="flex-1 min-w-0 leading-none">
            <p className="font-syne font-semibold text-cream text-[14px] tabular-nums leading-none">
              <span className="text-gold">+{amount}</span>{" "}
              <span className="text-cream/70 font-normal">Fangs claimed</span>
            </p>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/40 mt-1 leading-none">
              Day {day} streak
            </p>
          </div>

          {/* Dismiss */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="shrink-0 grid place-items-center w-6 h-6 rounded-full
              text-cream/40 hover:text-cream hover:bg-white/[0.08] transition-colors"
          >
            <X size={11} weight="bold" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function formatCountdown(ms: number): string {
  if (ms <= 0) return "Ready";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
}

function formatCountdownShort(ms: number): string {
  if (ms <= 0) return "Ready";
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function timeAgo(iso: string, nowMs: number): string {
  const diff = nowMs - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
