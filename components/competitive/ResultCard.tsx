"use client";

// Shared end-of-match result card for all competitive modes.
//
// JUICE: spring entrance for the whole card, the headline slams in, the score
// and ELO/Fang deltas COUNT UP (reusing the reduced-motion-aware CountUp), and
// a victory fires a confetti burst (Confetti is also reduced-motion-aware).
// A loss is dignified — no confetti, calmer entrance — but still clear. All
// animated values come straight from the `result` already in client state;
// nothing is re-fetched and no secret column is read.
//
// VOID / FORFEIT (2026-06): the result is a discriminated MatchOutcome.
//   - "voided"    → opponent never played. Neutral card, NO confetti, no score
//                   board, no ELO/Fang deltas (nothing changed). One way out.
//   - "forfeited" → the player quit a match both sides had engaged in. A loss
//                   with explicit "You forfeited" framing, otherwise identical
//                   to a normal defeat (real ELO/Fang deltas apply).
//   - "settled"   → the normal win/loss/draw, unchanged.

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { cdnUrl } from "@/lib/cdn";
import CountUp from "@/components/CountUp";
import Confetti from "@/components/Confetti";
import type { MatchOutcome } from "./useSettle";

export default function ResultCard({
  result,
  selfId,
  teamA,
}: {
  result: MatchOutcome;
  selfId: string;
  teamA: string[];
}) {
  const reduce = useReducedMotion();

  // ── VOIDED: opponent never engaged. No win/loss, no deltas, no confetti. ──
  if (result.kind === "voided") {
    const color = "#9AA7BD"; // neutral slate — deliberately not a win/loss color
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center w-full px-4">
        <motion.div
          initial={reduce ? false : { scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 20 }}
          className="relative overflow-hidden rounded-2xl p-8 sm:p-10 text-center w-full max-w-lg"
          style={{ background: "linear-gradient(135deg, #0c1020 0%, #060c18 100%)", border: `1px solid ${color}33` }}
        >
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}10 0%, transparent 60%)` }} />
          <div className="relative">
            <p className={`font-bebas text-5xl tracking-widest mb-4 ${reduce ? "" : "ca-slam"}`}
              style={{ color, textShadow: `0 0 24px ${color}30` }}>
              MATCH VOIDED
            </p>
            <p className="text-cream/65 font-syne text-sm sm:text-base leading-relaxed mb-7 max-w-sm mx-auto">
              Your opponent never played, so no Elo or Fangs changed.
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/compete/arena" className="font-bebas tracking-wider px-6 py-2.5 rounded-xl btn-gold text-sm">
                BACK TO ARENA
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── SETTLED or FORFEITED: both carry the full score payload. ──
  const forfeited = result.kind === "forfeited";
  const onTeamA = teamA.includes(selfId);
  const youWon =
    !forfeited &&
    result.winnerTeam !== "draw" &&
    ((result.winnerTeam === "a" && onTeamA) || (result.winnerTeam === "b" && !onTeamA));
  const draw = !forfeited && result.winnerTeam === "draw";

  const eloDelta = result.eloDeltas?.[selfId] ?? 0;
  const fangDelta = result.fangDelta?.[selfId] ?? 0;
  const eloAfter = result.eloAfter?.[selfId];
  const yourScore = onTeamA ? result.scoreA : result.scoreB;
  const oppScore = onTeamA ? result.scoreB : result.scoreA;

  const headline = forfeited ? "YOU FORFEITED" : draw ? "DRAW" : youWon ? "VICTORY" : "DEFEAT";
  const color = forfeited ? "#EF4444" : draw ? "#A855F7" : youWon ? "#FFD700" : "#EF4444";

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center w-full px-4">
      {/* Victory celebration — Confetti is self-gating on reduced motion. A
          forfeit never celebrates. */}
      {youWon && <Confetti trigger count={64} origin="center" duration={1600} />}

      <motion.div
        initial={reduce ? false : { scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 18 }}
        className="relative overflow-hidden rounded-2xl p-8 sm:p-10 text-center w-full max-w-lg"
        style={{ background: "linear-gradient(135deg, #0c1020 0%, #060c18 100%)", border: `1px solid ${color}40` }}
      >
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}12 0%, transparent 60%)` }} />
        <div className="relative">
          <p className={`font-bebas text-5xl tracking-widest mb-4 ${reduce ? "" : "ca-slam"}`}
            style={{ color, textShadow: `0 0 24px ${color}40` }}>
            {headline}
          </p>

          {forfeited && (
            <p className="text-cream/55 font-syne text-xs sm:text-sm leading-relaxed -mt-1 mb-5 max-w-sm mx-auto">
              You left the match. The loss stands.
            </p>
          )}

          <div className="flex items-center justify-center gap-8 mb-6">
            <div>
              <p className="text-cream/40 text-[10px] uppercase tracking-widest">Your Score</p>
              <p className="font-bebas text-3xl text-cream/85">
                <CountUp value={yourScore} duration={700} />
              </p>
            </div>
            <div className="text-cream/30 font-bebas text-2xl">vs</div>
            <div>
              <p className="text-cream/40 text-[10px] uppercase tracking-widest">Opponent</p>
              <p className="font-bebas text-3xl text-cream/60">
                <CountUp value={oppScore} duration={700} />
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-6 mb-6">
            <div className="px-4 py-2 rounded-xl border border-cream/10 bg-cream/[0.03]">
              <p className="text-cream/40 text-[10px] uppercase tracking-widest">Elo</p>
              <p className="font-bebas text-xl" style={{ color: eloDelta >= 0 ? "#50C878" : "#EF4444" }}>
                {eloDelta >= 0 ? "+" : ""}<CountUp value={eloDelta} duration={900} />
              </p>
              {typeof eloAfter === "number" && <p className="text-cream/40 text-[10px]">{eloAfter}</p>}
            </div>
            <div className="px-4 py-2 rounded-xl border border-cream/10 bg-cream/[0.03]">
              <p className="text-cream/40 text-[10px] uppercase tracking-widest flex items-center gap-1 justify-center">
                <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3 h-3 object-contain" /> Fangs
              </p>
              <p className="font-bebas text-xl" style={{ color: fangDelta >= 0 ? "#FFD700" : "#EF4444" }}>
                {fangDelta >= 0 ? "+" : ""}<CountUp value={fangDelta} duration={900} />
              </p>
            </div>
          </div>

          <div className="flex gap-3 justify-center">
            <Link href="/compete/arena" className="font-bebas tracking-wider px-6 py-2.5 rounded-xl btn-gold text-sm">
              PLAY AGAIN
            </Link>
            <Link href="/compete" className="font-bebas tracking-wider px-6 py-2.5 rounded-xl btn-outline text-sm">
              ARENA HOME
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
