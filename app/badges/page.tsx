"use client";

import { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getAllBadges, getUserBadges } from "@/lib/db";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import BadgeCard from "@/components/BadgeCard";
import type { Badge } from "@/types";
import { MedalMilitary, Lock, MagnifyingGlass, X } from "@phosphor-icons/react";
import Link from "next/link";

// Badge filter chips — same chip pattern as the Word Banks confidence filter
// (see components/Vocab/VocabList.tsx) so cross-surface UX stays consistent.
//
// Audit 2026-06-05 Bucket C #2: page used to be Earned / Locked split only —
// no rarity filter, no search, no sort — and with 8+ badges the grid is a
// wall. Filters apply to BOTH Earned + Locked grids (shared state) so a user
// who tunes "Show me only legendaries I haven't earned" gets it in one motion.

type RarityFilter = "all" | "common" | "rare" | "epic" | "legendary";
type SortMode = "recent" | "rarity" | "name";

const RARITY_RANK: Record<string, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  common: 3,
};

const RARITY_LABELS: { id: RarityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "common", label: "Common" },
  { id: "rare", label: "Rare" },
  { id: "epic", label: "Epic" },
  { id: "legendary", label: "Legendary" },
];

const SORT_LABELS: { id: SortMode; label: string }[] = [
  { id: "recent", label: "Recently earned" },
  { id: "rarity", label: "Rarest first" },
  { id: "name", label: "A → Z" },
];

export default function BadgesPage() {
  const { user } = useAuth();
  const [allBadges, setAllBadges] = useState<Badge[]>([]);
  const [earnedIds, setEarnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Filter / sort state — shared across Earned + Locked sections so toggling
  // a rarity chip or typing a query reflows both grids in lockstep.
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");

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

  // Apply rarity + search filters in one pass, then split into earned / locked.
  // useMemo keys on the three filter inputs + the badge list so revalidations
  // don't reflow the grids unnecessarily.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allBadges.filter(b => {
      if (rarityFilter !== "all" && b.rarity !== rarityFilter) return false;
      if (q) {
        const hay = `${b.name} ${b.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allBadges, rarityFilter, query]);

  // Sort comparator — shared across earned + locked (the "Recently earned"
  // mode falls back to rarity for locked badges since they have no
  // earnedAt; that keeps the locked grid stable instead of randomly ordered).
  const sortBadges = (list: Badge[], inEarnedGrid: boolean): Badge[] => {
    const arr = [...list];
    if (sort === "name") {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "rarity") {
      arr.sort((a, b) => (RARITY_RANK[a.rarity] ?? 99) - (RARITY_RANK[b.rarity] ?? 99));
    } else {
      // "recent" — only meaningful in the earned grid (locked badges have no
      // earnedAt). For the locked grid fall back to rarity-first so newcomers
      // see the chase items at the top.
      if (inEarnedGrid) {
        arr.sort((a, b) => {
          const ta = a.earnedAt ? new Date(a.earnedAt).getTime() : 0;
          const tb = b.earnedAt ? new Date(b.earnedAt).getTime() : 0;
          return tb - ta;
        });
      } else {
        arr.sort((a, b) => (RARITY_RANK[a.rarity] ?? 99) - (RARITY_RANK[b.rarity] ?? 99));
      }
    }
    return arr;
  };

  const earnedFiltered = sortBadges(filtered.filter(b => earnedIds.has(b.id)), true);
  const lockedFiltered = sortBadges(filtered.filter(b => !earnedIds.has(b.id)), false);

  // Are any filters active? Used to decide between "no badges yet" empty
  // state and "no results" empty state.
  const filtersActive = rarityFilter !== "all" || query.trim().length > 0;
  const noResults = filtered.length === 0 && allBadges.length > 0 && filtersActive;

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
        <BackButton />

        <div className="text-center mb-8 animate-slide-up">
          <MedalMilitary size={52} weight="fill" color="#FFD700" className="mx-auto mb-3" aria-hidden="true" />
          <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider mb-2">BADGES</h1>
          <p className="text-cream/50 text-sm">
            {earnedIds.size} of {allBadges.length} earned
          </p>
        </div>

        {/* Filter row — only shown once badges have loaded so the chips don't
            flicker into a skeleton. Search input + rarity chips + sort dropdown.
            Reuses the same glass-pill aesthetic as Word Bank filters. */}
        {!loading && allBadges.length > 0 && (
          <div className="mb-6 animate-slide-up" style={{ animationDelay: "0.05s" }}>
            {/* Search input — magnifier-glass pattern from VocabList */}
            <div className="relative mb-3">
              <MagnifyingGlass
                size={16}
                weight="regular"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/40 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search badges"
                className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-cream text-sm placeholder:text-cream/35 focus:outline-none focus:border-electric/40 transition-colors"
                aria-label="Search badges by name or description"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-cream/50 hover:text-cream hover:bg-white/10 transition-colors"
                  aria-label="Clear search"
                >
                  <X size={12} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Rarity chips + sort dropdown row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Filter badges by rarity">
                {RARITY_LABELS.map(r => {
                  const active = rarityFilter === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setRarityFilter(r.id)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${
                        active
                          ? "bg-electric/15 border-electric/50 text-cream"
                          : "bg-white/5 border-white/10 text-cream/65 hover:bg-white/10 hover:text-cream"
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>

              <label className="inline-flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cream/45">Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortMode)}
                  className="bg-white/[0.04] border border-white/10 text-cream text-xs font-semibold px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-electric/40 cursor-pointer"
                  aria-label="Sort badges"
                >
                  {SORT_LABELS.map(s => (
                    <option key={s.id} value={s.id} className="bg-navy-100">{s.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

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
        ) : noResults ? (
          <div className="text-center py-16 rounded-2xl" style={{ background: "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))", border: "1px solid rgba(74,144,217,0.08)" }}>
            <MagnifyingGlass size={32} weight="regular" color="rgba(238,244,255,0.4)" className="mx-auto mb-3" aria-hidden="true" />
            <p className="font-bebas text-xl text-cream/55 tracking-wider mb-1">No badges match those filters</p>
            <p className="text-cream/30 text-xs mb-4">Try a different rarity or clear your search.</p>
            <button
              onClick={() => { setRarityFilter("all"); setQuery(""); }}
              className="inline-block px-5 py-2 rounded-xl border border-electric/30 text-electric text-xs font-bold hover:bg-electric/10 transition-all"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <>
            {/* Earned Badges — rarity-tinted via shared <BadgeCard /> */}
            {earnedFiltered.length > 0 && (
              <div className="mb-10 animate-slide-up" style={{ animationDelay: "0.1s" }}>
                <h2 className="font-bebas text-2xl text-cream tracking-wider mb-4 flex items-center gap-2">
                  <span className="text-gold">★</span> EARNED
                  <span className="text-cream/30 text-base ml-1">({earnedFiltered.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {earnedFiltered.map(badge => (
                    <BadgeCard key={badge.id} badge={badge} size="md" earned />
                  ))}
                </div>
              </div>
            )}

            {/* Locked Badges — same component, earned=false handles the
                desaturated/dim treatment + lock overlay. */}
            {lockedFiltered.length > 0 && (
              <div className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
                <h2 className="font-bebas text-2xl text-cream/50 tracking-wider mb-4 flex items-center gap-2">
                  <Lock size={12} weight="regular" aria-hidden="true" /> LOCKED
                  <span className="text-cream/20 text-base ml-1">({lockedFiltered.length})</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {lockedFiltered.map(badge => (
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
