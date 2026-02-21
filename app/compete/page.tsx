"use client";

import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const COMPETE_TILES = [
  {
    href: "/duel",
    icon: "\u2694\uFE0F",
    title: "Duel",
    desc: "Challenge a friend to a 1v1 battle. 10 questions, 15 seconds each. Winner takes 2x coins.",
    accent: "#E74C3C",
  },
  {
    href: "/compete",
    icon: "\u26A1",
    title: "Blitz",
    desc: "Speed round. Answer as many questions as you can in 60 seconds. Top scores earn bonus rewards.",
    accent: "#FFD700",
    comingSoon: true,
  },
  {
    href: "/leaderboard",
    icon: "\u{1F3C6}",
    title: "Leaderboard",
    desc: "See where you rank against other players. Weekly and all-time standings updated live.",
    accent: "#4A90D9",
  },
];

export default function CompetePage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-16 pb-20 md:pb-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Header */}
          <div className="mb-6 animate-slide-up">
            <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider">COMPETE</h1>
            <div className="periodic-shimmer h-[2px] w-24 rounded-full mt-2 mb-1" />
            <p className="text-cream/40 text-sm mt-1">Test yourself against others. Climb the ranks.</p>
          </div>

          {/* ═══ Rank Summary Strip ═══ */}
          <div className="card mb-8 animate-slide-up" style={{ animationDelay: "0.05s" }}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-electric/10 border border-electric/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-base">&#x1F3C5;</span>
                </div>
                <div>
                  <p className="font-bebas text-xl text-cream leading-none">Unranked</p>
                  <p className="text-cream/40 text-[10px] font-semibold uppercase tracking-widest">Your Rank</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-base">&#x2705;</span>
                </div>
                <div>
                  <p className="font-bebas text-xl text-green-400 leading-none">0</p>
                  <p className="text-cream/40 text-[10px] font-semibold uppercase tracking-widest">Wins</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-base">&#x1F525;</span>
                </div>
                <div>
                  <p className="font-bebas text-xl text-orange-400 leading-none">0</p>
                  <p className="text-cream/40 text-[10px] font-semibold uppercase tracking-widest">Win Streak</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-base">&#x1F3AF;</span>
                </div>
                <div>
                  <p className="font-bebas text-xl text-gold leading-none">Top 10%</p>
                  <p className="text-cream/40 text-[10px] font-semibold uppercase tracking-widest">Goal</p>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ Mode Tiles ═══ */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {COMPETE_TILES.map((tile, i) => {
              const idleClass = i === 0 ? "idle-tilt" : i === 1 ? "idle-pulse" : "idle-shimmer";
              const idleDelay = i === 0 ? "0s" : i === 1 ? "1s" : "0.5s";
              return (
                <Link key={tile.title} href={tile.href}>
                  <div
                    className="relative card-hover hover-anim p-6 rounded-xl group cursor-pointer h-full animate-slide-up"
                    style={{ borderColor: `${tile.accent}30`, animationDelay: `${0.1 + i * 0.05}s` }}
                  >
                    {tile.comingSoon && (
                      <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-widest
                        px-2 py-0.5 rounded-full border text-cream/50"
                        style={{ borderColor: `${tile.accent}40`, background: `${tile.accent}15` }}>
                        Soon
                      </span>
                    )}
                    <span
                      className={`text-4xl group-hover:scale-110 transition-transform duration-300 inline-block mb-3 ${idleClass}`}
                      style={{ animationDelay: idleDelay }}
                    >
                      {tile.icon}
                    </span>
                    <p className="font-bebas text-2xl tracking-wider mb-1" style={{ color: tile.accent }}>
                      {tile.title}
                    </p>
                    <p className="text-cream/50 text-sm leading-relaxed">{tile.desc}</p>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* ═══ Weekly Tournament (Coming Soon) ═══ */}
          <div className="animate-slide-up" style={{ animationDelay: "0.25s" }}>
            <div className="relative card p-6 rounded-xl overflow-hidden" style={{ borderColor: "#9B59B630" }}>
              {/* Slow gradient shimmer overlay */}
              <div className="absolute inset-0 idle-shimmer-bar pointer-events-none" />
              <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-widest
                px-2 py-0.5 rounded-full border text-cream/50"
                style={{ borderColor: "#9B59B640", background: "#9B59B615" }}>
                Soon
              </span>
              <div className="flex items-center gap-4">
                <span className="text-4xl">&#x1F3C6;</span>
                <div className="flex-1">
                  <p className="font-bebas text-2xl tracking-wider" style={{ color: "#9B59B6" }}>Weekly Tournament</p>
                  <p className="text-cream/50 text-sm mt-0.5">
                    Compete in a week-long bracket against other players. Top 3 earn exclusive badges and coin prizes.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
