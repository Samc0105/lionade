"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Fire, Lightning, Coin, Clock } from "@phosphor-icons/react";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { mutateUserStats } from "@/lib/hooks";
import { toastSuccess, toastError, toastInfo } from "@/lib/toast";
import Confetti from "@/components/Confetti";
import ClaimBanner from "@/components/ClaimBanner";

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
    { refreshInterval: 60_000 },
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
        if (!r.data?.message) console.error("[streak:revive] failed", r.error);
        // r.data?.message is server-curated user copy (e.g. "Need X Fangs");
        // fall back to generic friendly copy otherwise.
        toastError(r.data?.message || "Couldn't revive. Try again.");
        return;
      }
      toastSuccess(`Streak restored. Back to ${r.data.restoredStreak} days. Don't lose it again.`, { duration: 4000 });
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 2200);
      void mutate();
      mutateUserStats(user.id);
    } catch (e) {
      console.error("[streak:revive] threw", e);
      toastError("Couldn't revive. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.04s" }}>
      {celebrate && <Confetti trigger={celebrate} count={50} palette={["#FFD700", "#22C55E", "#A855F7"]} duration={1500} />}
      <ClaimBanner
        variant="ember"
        size="panel"
        ariaLabel="Streak revive — limited-time window"
        icon={<Fire size={26} weight="fill" />}
        eyebrow="Streak broke — last chance"
        title={<>Bring back your <span className="text-gold">{previousStreak}-day</span> streak</>}
        description={<>You&apos;ve got <Countdown remainingMs={remainingMs} /> to revive it. After that, it&apos;s gone for good.</>}
        onDismiss={onDismiss}
        dismissLabel="Dismiss for this session"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-4">
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
                : "bg-white/[0.04] border border-white/[0.1] text-cream/60 cursor-not-allowed"
              }
              disabled:cursor-not-allowed disabled:opacity-60
            `}
          >
            <Coin size={16} weight="fill" />
            <span>{submitting ? "Reviving…" : `Revive · ${data.costFangs.toLocaleString()} Fangs`}</span>
          </button>

          {/* Cash button hidden until the Stripe rollout actually ships.
              Was rendering live alongside the Fangs path and firing a
              toastInfo("Cash purchases land with our Stripe rollout") which
              looked-live-but-isn't — a trust gap. Better to not render than
              to render a dead affordance. The Fangs button keeps the
              recovery flow available. */}
        </div>

        {!canAffordFangs && (
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/60 mt-2">
            Short on Fangs · cash revive path coming soon
          </p>
        )}
      </ClaimBanner>
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
