"use client";

import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const LEARN_TILES = [
  {
    href: "/quiz",
    icon: "\u{1F9E0}",
    title: "Daily Quiz",
    desc: "Test your knowledge with 10 questions. Earn coins and XP for every correct answer.",
    accent: "#4A90D9",
  },
  {
    href: "/quiz",
    icon: "\u{1F4DA}",
    title: "Subjects",
    desc: "Pick a subject and practice at your own pace. Track mastery across 7 categories.",
    accent: "#9B59B6",
  },
  {
    href: "/quiz",
    icon: "\u{1F4DD}",
    title: "Practice Sets",
    desc: "Curated question sets grouped by difficulty. Perfect for focused study sessions.",
    accent: "#2ECC71",
  },
  {
    href: "/learn",
    icon: "\u{1F4D6}",
    title: "Library",
    desc: "Browse community study materials, notes, and resources shared by other learners.",
    accent: "#E67E22",
    comingSoon: true,
  },
];

export default function LearnPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-16 pb-20 md:pb-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Header */}
          <div className="mb-8 animate-slide-up">
            <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider">LEARN</h1>
            <p className="text-cream/40 text-sm mt-1">Pick your path. Every question earns you coins.</p>
          </div>

          {/* Tiles grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {LEARN_TILES.map((tile) => (
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
