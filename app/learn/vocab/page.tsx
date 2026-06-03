"use client";

/**
 * /learn/vocab — Lionade Vocab feature.
 *
 * Layout: tabs (Add / Review / List). On mobile the tabs are a horizontal
 * segmented control that scrolls if needed; on desktop they sit centered.
 * Chosen over a stacked layout because the three sections have very different
 * input modes (form / flashcard / search list) and keeping each one full-width
 * makes each mode feel uncluttered. The Add and Review surfaces also benefit
 * from being visually "alone" so the user focuses on one word at a time.
 *
 * The active language pair is owned by this page (read from localStorage by
 * AddWordForm on mount; mirrored here for ReviewQueue scoping). We pull
 * streak data here too so the streak pill renders above the tabs as well as
 * inside the Review tab.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Plus, Cards, ListBullets } from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AddWordForm from "@/components/Vocab/AddWordForm";
import ReviewQueue from "@/components/Vocab/ReviewQueue";
import VocabList from "@/components/Vocab/VocabList";
import LanguageStreakPill, { type LangPair, type LanguageStreak } from "@/components/Vocab/LanguageStreakPill";
import { swrFetcher } from "@/lib/api-client";

type Tab = "add" | "review" | "list";

const STORAGE_KEY = "vocab_lang_pair";

const TABS: { id: Tab; label: string; Icon: typeof Plus }[] = [
  { id: "add", label: "Add", Icon: Plus },
  { id: "review", label: "Review", Icon: Cards },
  { id: "list", label: "Your List", Icon: ListBullets },
];

export default function VocabPage() {
  const [tab, setTab] = useState<Tab>("add");
  const [langPair, setLangPair] = useState<LangPair>("en-es");
  const [hydrated, setHydrated] = useState(false);

  // Sync lang pair from localStorage on mount. AddWordForm writes here too —
  // we read every time the storage event fires (cross-tab) AND we re-read on
  // tab switch (covers same-tab same-page edits cheaply).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en-es" || stored === "es-en") setLangPair(stored);
    } catch { /* noop */ }
    setHydrated(true);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === "en-es" || e.newValue === "es-en") setLangPair(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Re-read on every tab switch so a change made in Add reflects in Review
  // even within the same tab (the storage event doesn't fire same-tab).
  useEffect(() => {
    if (!hydrated) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en-es" || stored === "es-en") setLangPair(stored);
    } catch { /* noop */ }
  }, [tab, hydrated]);

  const { data: streakData } = useSWR<LanguageStreak[]>(
    "/api/vocab/streak",
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const activeStreak: LanguageStreak =
    streakData?.find(s => s.langPair === langPair) ?? { langPair, count: 0, lastDay: null };

  return (
    <ProtectedRoute>
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.4s var(--ease-out-expo, cubic-bezier(0.16,1,0.3,1)) both; }
        @media (prefers-reduced-motion: reduce) {
          .animate-slide-up { animation: none; }
        }
      `}</style>

      <div className="min-h-screen pt-16 pb-20 md:pb-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Header */}
          <header className="mb-7 animate-slide-up flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/55 mb-2">
                Learn / Vocab
              </p>
              <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-[0.08em] leading-none">
                Vocab
              </h1>
              <p className="font-syne text-sm text-cream/65 mt-2 max-w-md">
                Add a word, write your own definition, lock it in.
              </p>
            </div>
            <LanguageStreakPill streak={activeStreak} size="sm" />
          </header>

          {/* Tabs */}
          <nav
            className="mb-6 flex gap-1.5 overflow-x-auto pb-1 animate-slide-up"
            style={{ animationDelay: "0.04s" }}
            role="tablist"
            aria-label="Vocab sections"
          >
            {TABS.map(t => {
              const isActive = tab === t.id;
              const Icon = t.Icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`vocab-tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne font-bold text-sm transition-colors border whitespace-nowrap ${
                    isActive
                      ? "bg-electric text-navy border-electric"
                      : "bg-white/5 text-cream/70 border-white/10 hover:bg-white/10 hover:text-cream"
                  }`}
                >
                  <Icon size={14} weight="bold" aria-hidden="true" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Tab panels */}
          <section
            id={`vocab-tab-${tab}`}
            role="tabpanel"
            className="animate-slide-up"
            style={{ animationDelay: "0.08s" }}
          >
            {tab === "add" && <AddWordForm />}
            {tab === "review" && <ReviewQueue langPair={langPair} />}
            {tab === "list" && <VocabList />}
          </section>

        </div>
      </div>
    </ProtectedRoute>
  );
}
