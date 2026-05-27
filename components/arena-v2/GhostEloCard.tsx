"use client";

// Arena V2 — Ghost ELO Claim Card.
//
// Renders on the V2 lobby ABOVE the subject picker, but only when the
// current user has a pending offline ELO buffer (their ghost was
// challenged while they were offline).
//
// Data: GET /api/arena/v2/ghost-elo-summary via SWR. When hasPending is
// false the component renders nothing — no skeleton, no placeholder — so
// the lobby looks unchanged for users with no pending matches.
//
// Action: POST /api/arena/v2/claim-ghost-elo. On success we optimistically
// mutate the SWR cache to the empty shape, fire a brief toast, and the
// card unmounts on next render.
//
// Visual: glassmorphism card matching the rest of the V2 lobby — gold
// accent border, purple radial glow, framer-motion fade-in. Composition
// is: headline ("Your ghost ran N duels"), W-L-D row, ELO arrow row
// (current -> new, color-coded), Claim button. Respects
// prefers-reduced-motion via framer-motion's useReducedMotion hook.

import { useState } from "react";
import useSWR from "swr";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { toastSuccess, toastError } from "@/lib/toast";

interface GhostSummaryEntry {
  match_id: string;
  challenged_at: string;
  challenger_anon_handle: string;
  subject: string;
  outcome: "ghost_won" | "ghost_lost" | "draw";
  elo_delta: number;
}

interface SummaryResponse {
  pending: {
    elo_change: number;
    wins: number;
    losses: number;
    draws: number;
    summary: GhostSummaryEntry[];
    current_elo: number;
  };
  hasPending: boolean;
}

interface ClaimResponse {
  new_elo: number;
  wins_applied: number;
  losses_applied: number;
  draws_applied: number;
  elo_delta: number;
  noop?: boolean;
}

const SWR_KEY = "/api/arena/v2/ghost-elo-summary";

export default function GhostEloCard() {
  const reduced = useReducedMotion();
  const { data, mutate, isLoading } = useSWR<SummaryResponse>(SWR_KEY, swrFetcher, {
    revalidateOnFocus: true,
  });
  const [busy, setBusy] = useState(false);

  // Don't render anything until we know — avoids a skeleton flash for the
  // 95% case where the user has no pending buffer.
  if (isLoading || !data || !data.hasPending) return null;

  const { elo_change, wins, losses, draws, current_elo, summary } = data.pending;
  const totalMatches = wins + losses + draws;
  // Fallback if a summary entry was somehow missed during accumulation.
  const safeTotal = totalMatches > 0 ? totalMatches : summary.length;

  const newElo = current_elo + elo_change;
  const deltaPositive = elo_change >= 0;
  const deltaColor = elo_change === 0 ? "#A855F7" : deltaPositive ? "#86EFAC" : "#FCA5A5";

  const handleClaim = async () => {
    if (busy) return;
    setBusy(true);
    const res = await apiPost<ClaimResponse>("/api/arena/v2/claim-ghost-elo", {});
    setBusy(false);
    if (!res.ok || !res.data) {
      toastError("Could not claim. Try again in a moment.");
      return;
    }
    // Optimistic local mutate to the empty/no-pending shape so the card
    // unmounts immediately. SWR will revalidate on next focus.
    await mutate(
      {
        pending: {
          elo_change: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          summary: [],
          current_elo: res.data.new_elo,
        },
        hasPending: false,
      },
      { revalidate: false },
    );
    const applied = res.data.elo_delta;
    const sign = applied >= 0 ? "+" : "";
    toastSuccess(`${sign}${applied} ELO applied. New rating ${res.data.new_elo}.`);
  };

  return (
    <AnimatePresence>
      <motion.div
        key="ghost-elo-card"
        initial={reduced ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: reduced ? 0 : 0.3, ease: "easeOut" }}
        className="relative mb-7 rounded-2xl overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(168,85,247,0.10) 0%, rgba(124,58,237,0.04) 60%, rgba(255,215,0,0.06) 100%)",
          border: "1px solid rgba(168,85,247,0.35)",
          boxShadow:
            "0 0 30px rgba(168,85,247,0.10), inset 0 1px 0 rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Purple radial glow accent */}
        <div
          className="absolute -top-12 -right-10 w-48 h-48 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(168,85,247,0.20) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          {/* Tagline */}
          <div className="inline-flex items-center gap-2 mb-3 px-2.5 py-0.5 rounded-full text-[10px] font-bebas tracking-[0.2em]"
            style={{
              background: "rgba(168,85,247,0.15)",
              border: "1px solid rgba(168,85,247,0.4)",
              color: "#C4B5FD",
            }}
          >
            GHOST DUELS · WHILE YOU WERE OUT
          </div>

          {/* Headline */}
          <h3 className="font-bebas text-2xl sm:text-3xl tracking-wider text-cream leading-tight mb-1">
            Your ghost ran {safeTotal} duel{safeTotal === 1 ? "" : "s"}
          </h3>
          <p className="text-cream/45 text-xs sm:text-sm font-syne mb-4">
            Recorded runs you left behind got challenged. Claim the rating change.
          </p>

          {/* W-L-D row */}
          <div className="flex items-center gap-4 sm:gap-6 mb-4">
            <Stat label="WINS" value={wins} color="#86EFAC" />
            <Divider />
            <Stat label="LOSSES" value={losses} color="#FCA5A5" />
            <Divider />
            <Stat label="DRAWS" value={draws} color="#C4B5FD" />
          </div>

          {/* ELO transition */}
          <div className="flex items-center justify-between gap-3 mb-5">
            <div className="flex items-baseline gap-2">
              <span className="font-bebas text-[10px] tracking-[0.2em] text-cream/40">ELO</span>
              <span className="font-bebas text-2xl sm:text-3xl text-cream tracking-wider">
                {current_elo}
              </span>
              <span className="font-bebas text-xl text-cream/30 px-1">{"→"}</span>
              <span
                className="font-bebas text-2xl sm:text-3xl tracking-wider"
                style={{ color: deltaColor, textShadow: `0 0 18px ${deltaColor}33` }}
              >
                {newElo}
              </span>
            </div>
            <span
              className="font-bebas text-base sm:text-lg tracking-wider px-3 py-1 rounded-full"
              style={{
                background:
                  elo_change === 0
                    ? "rgba(168,85,247,0.10)"
                    : deltaPositive
                      ? "rgba(34,197,94,0.12)"
                      : "rgba(239,68,68,0.12)",
                border: `1px solid ${deltaColor}55`,
                color: deltaColor,
              }}
            >
              {deltaPositive && elo_change > 0 ? "+" : ""}
              {elo_change}
            </span>
          </div>

          {/* Claim button */}
          <button
            onClick={handleClaim}
            disabled={busy}
            className="w-full py-3 rounded-xl font-syne font-bold text-sm sm:text-base transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background:
                "linear-gradient(135deg, #FFD700 0%, #B8960C 50%, #FFD700 100%)",
              color: "#04080F",
              boxShadow: "0 4px 18px rgba(255,215,0,0.22), inset 0 1px 0 rgba(255,255,255,0.2)",
            }}
          >
            {busy ? "Claiming..." : "Claim ELO"}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-start">
      <span className="font-bebas text-[10px] tracking-[0.22em] text-cream/40">{label}</span>
      <span
        className="font-bebas text-2xl sm:text-3xl tracking-wider"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-6 bg-white/10" aria-hidden="true" />;
}
