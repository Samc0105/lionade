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
          <div className="mb-8 animate-slide-up">
            <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider">COMPETE</h1>
            <p className="text-cream/40 text-sm mt-1">Test yourself against others. Climb the ranks.</p>
          </div>

          {/* Tiles grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {COMPETE_TILES.map((tile) => (
              <Link key={tile.title} href={tile.href}>
                <div
                  className="relative card-hover p-6 rounded-xl group cursor-pointer h-full"
                  style={{ borderColor: `${tile.accent}30` }}
                >
                  {tile.comingSoon && (
                    <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-widest
                      px-2 py-0.5 rounded-full border text-cream/50"
                      style={{ borderColor: `${tile.accent}40`, background: `${tile.accent}15` }}>
                      Soon
                    </span>
                  )}
                  <span className="text-4xl group-hover:scale-110 transition-transform duration-300 inline-block mb-3">
                    {tile.icon}
                  </span>
                  <p className="font-bebas text-2xl tracking-wider mb-1" style={{ color: tile.accent }}>
                    {tile.title}
                  </p>
                  <p className="text-cream/50 text-sm leading-relaxed">{tile.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
