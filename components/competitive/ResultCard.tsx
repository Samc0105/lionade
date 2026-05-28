"use client";

// Shared end-of-match result card for all competitive modes.

import Link from "next/link";
import { cdnUrl } from "@/lib/cdn";
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
  const onTeamA = teamA.includes(selfId);
  const youWon =
    result.winnerTeam !== "draw" &&
    ((result.winnerTeam === "a" && onTeamA) || (result.winnerTeam === "b" && !onTeamA));
  const draw = result.winnerTeam === "draw";

  const eloDelta = result.eloDeltas?.[selfId] ?? 0;
  const fangDelta = result.fangDelta?.[selfId] ?? 0;
  const eloAfter = result.eloAfter?.[selfId];

  const headline = draw ? "DRAW" : youWon ? "VICTORY" : "DEFEAT";
  const color = draw ? "#A855F7" : youWon ? "#FFD700" : "#EF4444";

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center w-full px-4">
    <div className="relative overflow-hidden rounded-2xl p-8 sm:p-10 text-center w-full max-w-lg"
      style={{ background: "linear-gradient(135deg, #0c1020 0%, #060c18 100%)", border: `1px solid ${color}40` }}>
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}12 0%, transparent 60%)` }} />
      <div className="relative">
        <p className="font-bebas text-5xl tracking-widest mb-4" style={{ color, textShadow: `0 0 24px ${color}40` }}>
          {headline}
        </p>

        <div className="flex items-center justify-center gap-8 mb-6">
          <div>
            <p className="text-cream/40 text-[10px] uppercase tracking-widest">Your Score</p>
            <p className="font-bebas text-3xl text-cream/85">{onTeamA ? result.scoreA : result.scoreB}</p>
          </div>
          <div className="text-cream/30 font-bebas text-2xl">vs</div>
          <div>
            <p className="text-cream/40 text-[10px] uppercase tracking-widest">Opponent</p>
            <p className="font-bebas text-3xl text-cream/60">{onTeamA ? result.scoreB : result.scoreA}</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 mb-6">
          <div className="px-4 py-2 rounded-xl border border-cream/10 bg-cream/[0.03]">
            <p className="text-cream/40 text-[10px] uppercase tracking-widest">Elo</p>
            <p className="font-bebas text-xl" style={{ color: eloDelta >= 0 ? "#50C878" : "#EF4444" }}>
              {eloDelta >= 0 ? "+" : ""}{eloDelta}
            </p>
            {typeof eloAfter === "number" && <p className="text-cream/40 text-[10px]">{eloAfter}</p>}
          </div>
          <div className="px-4 py-2 rounded-xl border border-cream/10 bg-cream/[0.03]">
            <p className="text-cream/40 text-[10px] uppercase tracking-widest flex items-center gap-1 justify-center">
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3 h-3 object-contain" /> Fangs
            </p>
            <p className="font-bebas text-xl" style={{ color: fangDelta >= 0 ? "#FFD700" : "#EF4444" }}>
              {fangDelta >= 0 ? "+" : ""}{fangDelta}
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
    </div>
    </div>
  );
}
