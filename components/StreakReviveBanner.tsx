"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  Fire, Lightning, Coin, X, Sparkle, Clock,
} from "@phosphor-icons/react";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { mutateUserStats } from "@/lib/hooks";
import { toastSuccess, toastError, toastInfo } from "@/lib/toast";
import Confetti from "@/components/Confetti";

/**
 * Streak Revive banner — the Snapchat-style post-hoc save.
 *
 * Shows ONLY when the server confirms an open revive window exists for
 * the user. Big, animated, hard to miss; runs a live countdown to make
 * the urgency real. Two payment paths: 5,000 Fangs (works) or $0.99
 * (gated until Stripe rollout — the cash button shows a friendly toast).
 *
 * Self-hides on successful claim, on dismiss (session-only), or once
 * the window expires.
 */

interface ReviveStatus {
  open: boolean;
  reviveId?: string;
  previousStreak?: number;
  openedAt?: string;
  expiresAt?: string;
  remainingMs?: number;
  costFangs: number;
  costCents: number;
  coins?: number;
}

const SESSION_DISMISS_KEY = "lionade_streak_revive_dismissed";

export default function StreakReviveBanner() {
  const { user } = useAuth();
  const { data, mutate } = useSWR<ReviveStatus>(
    user?.id ? "/api/streak-revive" : null,
    swrFetcher,
    { revalidateOnFocus: true, refreshInterval: 60_000 },
  );

  const [dismissed, setDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  // Honor a same-session dismiss so the banner doesn't keep popping back
  // after the user explicitly closes it. Persists for the tab only.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_DISMISS_KEY) === "1") setDismissed(true);
  }, []);

  if (!user?.id) return null;
  if (!data?.open) return null;
  if (dismissed) return null;

  const previousStreak = data.previousStreak ?? 0;
  const remainingMs = Math.max(0, data.remainingMs ?? 0);
  const canAffordFangs = (data.coins ?? 0) >= data.costFangs;

  const onDismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined") sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
  };

  const claim = async (method: "fangs" | "cash") => {
    if (submitting) return;
    if (method === "cash") {
      toastInfo("Cash purchases land with our Stripe rollout. Use Fangs for now.");
      return;
    }
    if (!canAffordFangs) {
      toastInfo(`Need ${data.costFangs.toLocaleString()} Fangs (you have ${(data.coins ?? 0).toLocaleString()}).`);
      return;
    }
    setSubmitting(true);
    try {
      type R = { ok: boolean; restoredStreak?: number; coins?: number; message?: string };
      const r = await apiPost<R>("/api/streak-revive", { method });
      if (!r.ok || !r.data?.ok) {
        toastError(r.data?.message || r.error || "Couldn't revive — try again.");
        return;
      }
      toastSuccess(`Streak restored — back to ${r.data.restoredStreak} days. Don't lose it again.`, { duration: 4000 });
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 2200);
      void mutate();
      mutateUserStats(user.id);
    } catch (e) {
      toastError((e as Error).message || "Couldn't revive.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.04s" }}>
      {celebrate && <Confetti trigger={celebrate} count={50} palette={["#FFD700", "#22C55E", "#A855F7"]} duration={1500} />}
      <div
        className="relative rounded-[14px] border overflow-hidden p-5 sm:p-6"
        style={{
          borderColor: "rgba(239, 68, 68, 0.35)",
          background: "linear-gradient(135deg, rgba(239,68,68,0.10) 0%, rgba(168,85,247,0.08) 100%)",
        }}
      >
        {/* Decorative ember glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background: "radial-gradient(circle at 12% 20%, rgba(239,68,68,0.18), transparent 55%)",
          }}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss for this session"
          className="absolute top-3 right-3 z-10 grid place-items-center w-7 h-7 rounded-full
            text-cream/40 hover:text-cream hover:bg-white/[0.08] transition-colors"
        >
          <X size={13} weight="bold" />
        </button>

        <div className="relative flex items-start gap-4 mb-4">
          <div
            className="shrink-0 grid place-items-center w-12 h-12 sm:w-14 sm:h-14 rounded-full"
            style={{ background: "rgba(239,68,68,0.18)", color: "#EF4444" }}
          >
            <Fire size={26} weight="fill" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#EF4444]/80 mb-1">
              Streak broke — last chance
            </p>
            <h2 className="font-bebas text-[28px] sm:text-[34px] tracking-[0.04em] text-cream leading-none mb-1.5">
              Bring back your <span className="text-gold">{previousStreak}-day</span> streak
            </h2>
            <p className="text-[13px] text-cream/65 leading-snug">
              You've got <Countdown remainingMs={remainingMs} /> to revive it. After that, it's gone for good.
            </p>
          </div>
        </div>

        <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => claim("fangs")}
            disabled={submitting || !canAffordFangs}
            className={`
              group flex items-center justify-center gap-2 rounded-[10px]
              px-4 py-3 font-syne font-semibold text-[14px]
              transition-all duration-200 active:scale-[0.98]
              ${canAffordFangs
                ? "bg-gold text-navy hover:bg-gold/90 shadow-md shadow-gold/20"
                : "bg-white/[0.04] border border-white/[0.1] text-cream/40 cursor-not-allowed"
              }
              disabled:cursor-not-allowed disabled:opacity-60
            `}
          >
            <Coin size={16} weight="fill" />
            <span>{submitting ? "Reviving…" : `Revive · ${data.costFangs.toLocaleString()} Fangs`}</span>
          </button>

          <button
            type="button"
            onClick={() => claim("cash")}
            disabled={submitting}
            className="group flex items-center justify-center gap-2 rounded-[10px]
              px-4 py-3 font-syne font-semibold text-[14px]
              bg-white/[0.05] border border-white/[0.12] text-cream
              hover:bg-white/[0.08] hover:border-white/[0.22]
              transition-all duration-200 active:scale-[0.98]
              disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Lightning size={15} weight="fill" className="text-gold" />
            <span>Revive · $0.99</span>
          </button>
        </div>

        {!canAffordFangs && (
          <p className="relative font-mono text-[10px] uppercase tracking-[0.22em] text-cream/40 mt-2">
            Short on Fangs · cash path coming with Stripe rollout
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Countdown — refreshes every second from the open expires_at deadline.
// Hides itself once the window closes (parent will re-fetch and unmount).
// ─────────────────────────────────────────────────────────────────────────────
function Countdown({ remainingMs }: { remainingMs: number }) {
  const [deadline] = useState(() => Date.now() + remainingMs);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const left = Math.max(0, deadline - now);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);

  return (
    <span className="inline-flex items-baseline gap-1 font-mono tabular-nums text-cream/90">
      <Clock size={11} weight="bold" className="self-center text-cream/55" />
      <span>{hours}h</span>
      <span>{minutes.toString().padStart(2, "0")}m</span>
      <span className="text-cream/50">{seconds.toString().padStart(2, "0")}s</span>
    </span>
  );
}
