"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getAllBadges, getUserBadges } from "@/lib/db";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";

const RARITY_STYLES: Record<string, { border: string; bg: string; text: string; glow: string }> = {
  common:    { border: "border-gray-500/30",   bg: "bg-gray-500/10",   text: "text-gray-400",   glow: "" },
  rare:      { border: "border-blue-500/30",   bg: "bg-blue-500/10",   text: "text-blue-400",   glow: "shadow-[0_0_12px_rgba(59,130,246,0.15)]" },
  epic:      { border: "border-purple-500/30", bg: "bg-purple-500/10", text: "text-purple-400", glow: "shadow-[0_0_12px_rgba(168,85,247,0.15)]" },
  legendary: { border: "border-gold/30",       bg: "bg-gold/10",       text: "text-gold",       glow: "shadow-[0_0_16px_rgba(255,215,0,0.2)]" },
};

interface Badge {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  rarity: string;
  earnedAt?: string;
}

export default function BadgesPage() {
  const { user } = useAuth();
  const [allBadges, setAllBadges] = useState<Badge[]>([]);
  const [earnedIds, setEarnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [all, earned] = await Promise.all([
          getAllBadges(),
          getUserBadges(user.id),
        ]);
        setAllBadges(all);
        setEarnedIds(new Set(earned.map((b: any) => b.id)));
      } catch (err) {
        console.error("[Badges] Failed to load:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const earned = allBadges.filter(b => earnedIds.has(b.id));
  const locked = allBadges.filter(b => !earnedIds.has(b.id));

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
        <BackButton />

        <div className="text-center mb-10 animate-slide-up">
          <span className="text-5xl block mb-3">🏅</span>
          <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider mb-2">BADGES</h1>
          <p className="text-cream/50 text-sm">
            {earned.length} of {allBadges.length} earned
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-40 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : allBadges.length === 0 ? (
          <div className="text-center py-20 rounded-2xl" style={{ background: "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))", border: "1px solid rgba(74,144,217,0.08)" }}>
            <span className="text-4xl block mb-3">🔒</span>
            <p className="font-bebas text-2xl text-cream/50 tracking-wider mb-1">No badges yet</p>
            <p className="text-cream/30 text-sm">Complete quizzes and challenges to earn badges.</p>
          </div>
        ) : (
          <>
            {/* Earned Badges */}
            {earned.length > 0 && (
              <div className="mb-10 animate-slide-up" style={{ animationDelay: "0.1s" }}>
                <h2 className="font-bebas text-2xl text-cream tracking-wider mb-4 flex items-center gap-2">
                  <span className="text-gold">★</span> EARNED
                  <span className="text-cream/30 text-base ml-1">({earned.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {earned.map(badge => {
                    const s = RARITY_STYLES[badge.rarity] ?? RARITY_STYLES.common;
                    return (
                      <div key={badge.id}
                        className={`rounded-2xl border ${s.border} ${s.glow} p-5 text-center transition-all duration-200 hover:scale-[1.03]`}
                        style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.9), rgba(6,12,24,0.95))" }}>
                        <span className="text-4xl block mb-3">{badge.icon}</span>
                        <p className="font-bebas text-lg text-cream tracking-wide mb-1">{badge.name}</p>
                        <span className={`text-[10px] uppercase tracking-widest font-bold ${s.text}`}>{badge.rarity}</span>
                        {badge.description && (
                          <p className="text-cream/30 text-[11px] mt-2 leading-relaxed">{badge.description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Locked Badges */}
            {locked.length > 0 && (
              <div className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
                <h2 className="font-bebas text-2xl text-cream/50 tracking-wider mb-4 flex items-center gap-2">
                  <span>🔒</span> LOCKED
                  <span className="text-cream/20 text-base ml-1">({locked.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {locked.map(badge => (
                    <div key={badge.id}
                      className="rounded-2xl border border-white/5 p-5 text-center opacity-40"
                      style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.5), rgba(6,12,24,0.5))" }}>
                      <span className="text-4xl block mb-3 grayscale">{badge.icon}</span>
                      <p className="font-bebas text-lg text-cream/50 tracking-wide mb-1">{badge.name}</p>
                      <span className="text-[10px] uppercase tracking-widest font-bold text-cream/20">{badge.rarity}</span>
                      {badge.description && (
                        <p className="text-cream/20 text-[11px] mt-2 leading-relaxed">{badge.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}
