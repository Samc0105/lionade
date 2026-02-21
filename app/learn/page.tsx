"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";

/* ── Ninny Modal ────────────────────────────────────────────── */

function NinnyModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative rounded-2xl border border-electric/20 max-w-md w-full p-8 text-center animate-slide-up"
        style={{
          background: "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon circle */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{
            background:
              "radial-gradient(circle at 40% 35%, #E67E2225 0%, #E67E220A 70%, transparent 100%)",
            boxShadow: "0 0 30px #E67E2218, 0 0 0 1px #E67E2220",
          }}
        >
          <span className="text-4xl">&#x1F916;</span>
        </div>

        <p className="font-bebas text-2xl text-cream tracking-wider mb-1">
          Study With Ninny{" "}
          <span className="text-cream/40">(Coming Soon)</span>
        </p>
        <p className="text-cream/50 text-sm leading-relaxed mb-6 max-w-sm mx-auto">
          Upload anything or tell Ninny what you&apos;re studying. Ninny will
          summarize, generate flashcards, and create practice questions.
        </p>

        <div className="flex flex-col sm:flex-row gap-2.5 justify-center mb-6">
          <button
            disabled
            className="font-syne font-semibold text-sm px-5 py-2.5 rounded-xl border border-cream/10
              text-cream/25 bg-white/5 cursor-not-allowed"
          >
            Upload Material (Soon)
          </button>
          <button
            disabled
            className="font-syne font-semibold text-sm px-5 py-2.5 rounded-xl border border-cream/10
              text-cream/25 bg-white/5 cursor-not-allowed"
          >
            Tell Ninny What to Study (Soon)
          </button>
        </div>

        <button
          onClick={onClose}
          className="font-syne font-bold text-sm px-6 py-2.5 rounded-lg transition-all duration-200
            active:scale-95 text-navy bg-electric hover:bg-electric-light"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/* ── Coming Soon Modal (Practice Sets) ────────────────────── */

function ComingSoonModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative rounded-2xl border border-electric/20 max-w-sm w-full p-8 text-center animate-slide-up"
        style={{
          background: "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{
            background:
              "radial-gradient(circle at 40% 35%, #2ECC7125 0%, #2ECC710A 70%, transparent 100%)",
            boxShadow: "0 0 30px #2ECC7118, 0 0 0 1px #2ECC7120",
          }}
        >
          <span className="text-3xl">&#x1F4DD;</span>
        </div>
        <p className="font-bebas text-2xl text-cream tracking-wider mb-1">
          Practice Sets
        </p>
        <span
          className="inline-block text-[10px] font-bold uppercase tracking-widest
          px-2.5 py-0.5 rounded-full border border-[#2ECC71]/30 text-[#2ECC71]/70 bg-[#2ECC71]/10 mb-3"
        >
          Coming Soon
        </span>
        <p className="text-cream/50 text-sm leading-relaxed mb-5">
          Curated question sets grouped by difficulty. Perfect for focused study
          sessions.
        </p>
        <button
          onClick={onClose}
          className="font-syne font-bold text-sm px-6 py-2.5 rounded-lg transition-all duration-200
            active:scale-95 text-navy bg-electric hover:bg-electric-light"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/* ── Bubble config ─────────────────────────────────────────── */

const BUBBLES = [
  {
    id: "quiz",
    icon: "\u{1F9E0}",
    title: "Daily Quiz",
    subtitle: "5 min \u2022 +10 coins",
    color: "#4A90D9",
    action: "navigate" as const,
    href: "/quiz",
    primary: true,
  },
  {
    id: "subjects",
    icon: "\u{1F4DA}",
    title: "Subjects",
    subtitle: "Track mastery across 7 topics",
    color: "#9B59B6",
    action: "navigate" as const,
    href: "/quiz",
  },
  {
    id: "practice",
    icon: "\u{1F4DD}",
    title: "Practice Sets",
    subtitle: "Timed focus sessions",
    color: "#2ECC71",
    action: "modal-practice" as const,
  },
  {
    id: "ninny",
    icon: "\u{1F916}",
    title: "Study With Ninny",
    subtitle: "AI summaries \u2022 Flashcards",
    color: "#E67E22",
    action: "modal-ninny" as const,
    badge: "Soon",
    extraLine: "Personalized AI study coach.",
  },
];

/* ── Page ───────────────────────────────────────────────────── */

export default function LearnPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [showNinny, setShowNinny] = useState(false);
  const [showPractice, setShowPractice] = useState(false);

  const handleBubble = (bubble: (typeof BUBBLES)[number]) => {
    if (bubble.action === "navigate" && "href" in bubble) {
      router.push(bubble.href);
    } else if (bubble.action === "modal-ninny") {
      setShowNinny(true);
    } else if (bubble.action === "modal-practice") {
      setShowPractice(true);
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-16 pb-20 md:pb-8">
        <div
          className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center"
          style={{ minHeight: "calc(100vh - 8rem)" }}
        >
          {/* ── Hero ── */}
          <div className="text-center mb-10 sm:mb-14 animate-slide-up">
            <h1 className="font-bebas text-6xl sm:text-7xl text-cream tracking-wider glow-electric">
              LEARN
            </h1>
            <p className="text-cream/50 text-sm sm:text-base mt-3 font-syne">
              Pick your path. Every question earns you coins.
            </p>
            <p className="text-cream/20 text-[11px] mt-2 font-syne">
              Start with Daily Quiz to build streaks.
            </p>

            {/* Progress row */}
            {user && (
              <div className="flex items-center justify-center gap-5 sm:gap-6 mt-4">
                <span className="text-cream/20 text-[11px] font-syne">
                  &#x1F525; Streak: {user.streak}
                </span>
                <span className="text-cream/20 text-[11px] font-syne">
                  &#x26A1; {user.xp.toLocaleString()} XP
                </span>
                <span className="text-cream/20 text-[11px] font-syne">
                  &#x1FA99; {user.coins.toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {/* ── 2x2 Bubble Grid ── */}
          <div className="grid grid-cols-2 gap-8 sm:gap-12">
            {BUBBLES.map((bubble, i) => {
              const isPrimary = "primary" in bubble && bubble.primary;
              return (
                <button
                  key={bubble.id}
                  onClick={() => handleBubble(bubble)}
                  className="group flex flex-col items-center gap-3 sm:gap-4 animate-slide-up outline-none cursor-pointer"
                  style={{ animationDelay: `${0.08 + i * 0.08}s` }}
                >
                  {/* Circle wrapper — idle float staggered per bubble */}
                  <div
                    className="relative idle-float"
                    style={{ animationDuration: `${5 + i * 0.7}s`, animationDelay: `${i * 1.2}s` }}
                  >
                    {/* Ninny breathing glow */}
                    {bubble.id === "ninny" && (
                      <div
                        className="absolute -inset-2 rounded-full idle-pulse pointer-events-none blur-lg"
                        style={{ background: `${bubble.color}0A` }}
                      />
                    )}
                    {/* Hover glow halo */}
                    <div
                      className="absolute -inset-3 rounded-full opacity-0 group-hover:opacity-100
                        transition-opacity duration-300 blur-xl pointer-events-none"
                      style={{ background: `${bubble.color}${isPrimary ? "18" : "12"}` }}
                    />

                    {/* Main bubble */}
                    <div
                      className={`relative rounded-full flex items-center justify-center
                        transition-all duration-200 ease-out periodic-glow
                        group-hover:scale-105 group-hover:-translate-y-0.5 group-hover:brightness-110
                        group-active:scale-95
                        ${isPrimary
                          ? "w-[7.5rem] h-[7.5rem] sm:w-[10rem] sm:h-[10rem]"
                          : "w-28 h-28 sm:w-36 sm:h-36"
                        }`}
                      style={{
                        background: `radial-gradient(circle at 40% 35%, ${bubble.color}${isPrimary ? "28" : "20"} 0%, ${bubble.color}08 60%, transparent 100%)`,
                        boxShadow: isPrimary
                          ? `0 0 0 1px ${bubble.color}20, 0 4px 28px ${bubble.color}10`
                          : `0 0 0 1px ${bubble.color}15, 0 4px 24px ${bubble.color}06`,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = isPrimary
                          ? `0 0 0 1.5px ${bubble.color}50, 0 8px 44px ${bubble.color}28, 0 0 80px ${bubble.color}10`
                          : `0 0 0 1.5px ${bubble.color}40, 0 8px 40px ${bubble.color}22, 0 0 80px ${bubble.color}0C`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = isPrimary
                          ? `0 0 0 1px ${bubble.color}20, 0 4px 28px ${bubble.color}10`
                          : `0 0 0 1px ${bubble.color}15, 0 4px 24px ${bubble.color}06`;
                      }}
                    >
                      <span
                        className={`group-hover:scale-105 transition-transform duration-200
                          ${isPrimary ? "text-[3.5rem] sm:text-7xl" : "text-5xl sm:text-6xl"}`}
                        style={{
                          filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.3))",
                        }}
                      >
                        {bubble.icon}
                      </span>
                    </div>

                    {/* Badge */}
                    {bubble.badge && (
                      <span
                        className="absolute -top-1 -right-1 text-[9px] font-bold uppercase tracking-widest
                          px-2 py-0.5 rounded-full backdrop-blur-sm"
                        style={{
                          background: `${bubble.color}20`,
                          border: `1px solid ${bubble.color}40`,
                          color: bubble.color,
                        }}
                      >
                        {bubble.badge}
                      </span>
                    )}
                  </div>

                  {/* Label */}
                  <div className="text-center">
                    <p
                      className="font-bebas text-lg sm:text-xl tracking-wider transition-all duration-200"
                      style={{ color: bubble.color }}
                    >
                      <span className="group-hover:[text-shadow:0_0_12px_currentColor] transition-all duration-200">
                        {bubble.title}
                      </span>
                    </p>
                    <p className="text-cream/30 text-[11px] sm:text-xs mt-0.5 font-syne">
                      {bubble.subtitle}
                    </p>
                    {"extraLine" in bubble && bubble.extraLine && (
                      <p className="text-cream/15 text-[10px] mt-0.5 font-syne">
                        {bubble.extraLine}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showNinny && <NinnyModal onClose={() => setShowNinny(false)} />}
      {showPractice && (
        <ComingSoonModal onClose={() => setShowPractice(false)} />
      )}
    </ProtectedRoute>
  );
}
