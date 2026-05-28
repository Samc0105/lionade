"use client";

// Shared end-of-match result card for all competitive modes.
//
// JUICE: spring entrance for the whole card, the headline slams in, the score
// and ELO/Fang deltas COUNT UP (reusing the reduced-motion-aware CountUp), and
// a victory fires a confetti burst (Confetti is also reduced-motion-aware).
// A loss is dignified — no confetti, calmer entrance — but still clear. All
// animated values come straight from the `result` already in client state;
// nothing is re-fetched and no secret column is read.

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { cdnUrl } from "@/lib/cdn";
import CountUp from "@/components/CountUp";
import Confetti from "@/components/Confetti";
import type { SettleResult } from "./useSettle";

export default function ResultCard({
  result,
  selfId,
  teamA,
}: {
  result: SettleResult;
  selfId: string;
  teamA: string[];
}) {
  const reduce = useReducedMotion();
  const [fireConfetti, setFireConfetti] = useState(true);

  const onTeamA = teamA.includes(selfId);
  const youWon =
    result.winnerTeam !== "draw" &&
    ((result.winnerTeam === "a" && onTeamA) || (result.winnerTeam === "b" && !onTeamA));
  const draw = result.winnerTeam === "draw";

  const eloDelta = result.eloDeltas?.[selfId] ?? 0;
  const fangDelta = result.fangDelta?.[selfId] ?? 0;
  const eloAfter = result.eloAfter?.[selfId];
  const yourScore = onTeamA ? result.scoreA : result.scoreB;
  const oppScore = onTeamA ? result.scoreB : result.scoreA;

  const headline = draw ? "DRAW" : youWon ? "VICTORY" : "DEFEAT";
  const color = draw ? "#A855F7" : youWon ? "#FFD700" : "#EF4444";

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center w-full px-4">
      {/* Victory celebration — Confetti is self-gating on reduced motion. */}
      {youWon && <Confetti trigger={fireConfetti} count={64} origin="center" duration={1600} onComplete={() => setFireConfetti(false)} />}

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
