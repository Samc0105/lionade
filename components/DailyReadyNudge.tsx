"use client";

import { useState } from "react";
import useSWR from "swr";
import { Coin, ArrowUpRight, X } from "@phosphor-icons/react";
import { swrFetcher } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";

/**
 * Tiny dashboard chip that nudges the user to claim their daily Fangs
 * via the gold "Daily" pill in the navbar. Auto-hides when the daily
 * isn't available (just claimed, or still on cooldown), so there's no
 * extra dismiss state — the natural lifecycle handles it.
 *
 * First-time users (lifetimeFangs == 0) get a slightly different copy
 * since this is also the first reward they'll ever earn. We removed the
 * signup-bonus deposit; this chip is the breadcrumb that replaces it.
 */

interface StatusResponse {
  available: boolean;
  nextAmount: number;
  lifetimeFangs: number;
  totalClaims: number;
}

export default function DailyReadyNudge() {
  const { user } = useAuth();
  // Same key the navbar's ClockInButton already uses → SWR dedupes the
  // fetch, so this widget is effectively free.
  const { data } = useSWR<StatusResponse>(
    user?.id ? "/api/login-bonus" : null,
    swrFetcher,
    { revalidateOnFocus: true },
  );
  const [dismissed, setDismissed] = useState(false);

  if (!user?.id) return null;
  if (!data?.available) return null;
  if (dismissed) return null;

  const isFirstClaim = data.totalClaims === 0;

  return (
    <div className="mb-4 animate-slide-up" style={{ animationDelay: "0.02s" }}>
      <div
        className="relative flex items-center gap-3 rounded-full px-4 py-2.5
          border border-gold/35 bg-gradient-to-r from-gold/[0.08] via-gold/[0.04] to-transparent
          backdrop-blur"
        style={{ boxShadow: "0 0 20px rgba(255,215,0,0.10)" }}
      >
        <span
          className="shrink-0 grid place-items-center w-7 h-7 rounded-full bg-gold/[0.15] text-gold"
          aria-hidden="true"
        >
          <Coin size={13} weight="fill" />
        </span>

        <p className="flex-1 text-[13px] text-cream/85 leading-snug">
          {isFirstClaim ? (
            <>
              <span className="font-syne font-semibold text-cream">Welcome.</span>{" "}
              <span className="text-cream/65">
                Tap the gold pill up top for your first {data.nextAmount} Fangs.
              </span>
            </>
          ) : (
            <>
              <span className="font-syne font-semibold text-cream">
                Daily Fangs are ready.
              </span>{" "}
              <span className="text-cream/65">
                Cash out from the gold pill in the navbar.
              </span>
            </>
          )}
        </p>

        <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-gold shrink-0">
          <ArrowUpRight size={11} weight="bold" />
          +{data.nextAmount}F
        </span>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss reminder"
          className="shrink-0 grid place-items-center w-6 h-6 rounded-full
            text-cream/35 hover:text-cream hover:bg-white/[0.06] transition-colors"
        >
          <X size={11} weight="bold" />
        </button>
      </div>
    </div>
  );
}
