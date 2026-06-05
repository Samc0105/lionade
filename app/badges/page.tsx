"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getAllBadges, getUserBadges } from "@/lib/db";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import BadgeCard from "@/components/BadgeCard";
import type { Badge } from "@/types";
import { MedalMilitary, Lock } from "@phosphor-icons/react";
import Link from "next/link";

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
        // Defensive: server may return description as null; BadgeCard
        // expects string. Coerce so we don't render the literal "null".
        const norm = (b: any): Badge => ({
          id: b.id,
          name: b.name,
          description: b.description ?? "",
          icon: b.icon,
          rarity: b.rarity,
          earnedAt: b.earnedAt,
        });
        setAllBadges(all.map(norm));
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
          <MedalMilitary size={52} weight="fill" color="#FFD700" className="mx-auto mb-3" aria-hidden="true" />
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
            <Lock size={40} weight="regular" color="rgba(238,244,255,0.4)" className="mx-auto mb-3" aria-hidden="true" />
            <p className="font-bebas text-2xl text-cream/50 tracking-wider mb-1">No badges yet</p>
            <p className="text-cream/30 text-sm mb-5">Complete quizzes and challenges to earn badges.</p>
            <Link href="/quiz" className="inline-block px-6 py-2.5 rounded-xl bg-electric text-white text-sm font-bold hover:brightness-110 transition-all">
              Start a quiz
            </Link>
          </div>
        ) : (
          <>
            {/* Earned Badges — rarity-tinted via shared <BadgeCard /> */}
            {earned.length > 0 && (
              <div className="mb-10 animate-slide-up" style={{ animationDelay: "0.1s" }}>
                <h2 className="font-bebas text-2xl text-cream tracking-wider mb-4 flex items-center gap-2">
                  <span className="text-gold">★</span> EARNED
                  <span className="text-cream/30 text-base ml-1">({earned.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {earned.map(badge => (
                    <BadgeCard key={badge.id} badge={badge} size="md" earned />
                  ))}
                </div>
              </div>
            )}

            {/* Locked Badges — same component, earned=false handles the
                desaturated/dim treatment + lock overlay. */}
            {locked.length > 0 && (
              <div className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
                <h2 className="font-bebas text-2xl text-cream/50 tracking-wider mb-4 flex items-center gap-2">
                  <Lock size={12} weight="regular" aria-hidden="true" /> LOCKED
                  <span className="text-cream/20 text-base ml-1">({locked.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {locked.map(badge => (
                    <BadgeCard key={badge.id} badge={badge} size="md" earned={false} />
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
