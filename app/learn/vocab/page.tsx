"use client";

/**
 * /learn/vocab — Lionade Word Banks V2.
 *
 * The page now centers around USER-CREATED themed BANKS rather than language
 * pairs. Each Word Bank can be a LANGUAGE bank (e.g. Spanish vocab, src→tgt
 * translation flow) or a GENERAL bank (e.g. AWS, biology, anything — the
 * server cascades Wikipedia → AI → manual for the reference definition).
 *
 * Active bank state lives in the URL (`?bank=<slug>`) so deep-linking + the
 * browser back button work cleanly. `localStorage` holds the last-active slug
 * as a fallback only — used to seed the URL on first land at /learn/vocab
 * with no query. The URL is always the source of truth once the page is
 * mounted; localStorage gets written every time the URL changes.
 *
 * If the user has zero banks, we route to a "Create your first bank" empty
 * state in place of the tabs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Plus, Cards, ListBullets, BookOpen, GlobeHemisphereWest } from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AddWordForm from "@/components/Vocab/AddWordForm";
import ReviewQueue from "@/components/Vocab/ReviewQueue";
import VocabList from "@/components/Vocab/VocabList";
import BankSelector from "@/components/Vocab/BankSelector";
import CreateBankModal, { type VocabBank } from "@/components/Vocab/CreateBankModal";
import BankStreakPill, { type BankStreak } from "@/components/Vocab/BankStreakPill";
import { swrFetcher } from "@/lib/api-client";

type Tab = "add" | "review" | "list";

const TABS: { id: Tab; label: string; Icon: typeof Plus }[] = [
  { id: "add", label: "Add", Icon: Plus },
  { id: "review", label: "Review", Icon: Cards },
  { id: "list", label: "Your List", Icon: ListBullets },
];

const ACTIVE_BANK_KEY = "vocab_active_bank_slug";

export default function VocabPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlBank = searchParams.get("bank");

  const [tab, setTab] = useState<Tab>("add");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // SWR-powered bank list — single source of truth for what banks the user owns.
  const { data: banksData, isLoading: banksLoading, mutate: mutateBanks } = useSWR<{ banks: VocabBank[] }>(
    "/api/vocab/banks",
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const banks = useMemo(() => banksData?.banks ?? [], [banksData]);

  // Resolve the active bank from URL. If URL has no `bank`, fall back to
  // localStorage. If localStorage is empty too, pick the first bank in the
  // list. Whenever the resolved slug differs from the URL, push it back via
  // router.replace so deep-links + history stay clean (replace, not push, so
  // back-button still leaves the page on the first try).
  const activeBank: VocabBank | null = useMemo(() => {
    if (banks.length === 0) return null;
    if (urlBank) {
      const found = banks.find(b => b.slug === urlBank);
      if (found) return found;
    }
    return banks[0];
  }, [banks, urlBank]);

  // Sync URL + localStorage when activeBank settles.
  useEffect(() => {
    if (!activeBank) return;
    if (urlBank !== activeBank.slug) {
      router.replace(`/learn/vocab?bank=${encodeURIComponent(activeBank.slug)}`, { scroll: false });
    }
    try {
      window.localStorage.setItem(ACTIVE_BANK_KEY, activeBank.slug);
    } catch { /* localStorage unavailable */ }
  }, [activeBank, urlBank, router]);

  // First-load fallback: if URL has no `bank` and we haven't fetched banks
  // yet, peek at localStorage so the page can pre-route to the user's last
  // bank instead of flashing the first-bank default for a frame.
  useEffect(() => {
    if (urlBank) return;
    if (banksLoading) return;
    if (banks.length === 0) return;
    try {
      const stored = window.localStorage.getItem(ACTIVE_BANK_KEY);
      if (stored && banks.some(b => b.slug === stored)) {
        router.replace(`/learn/vocab?bank=${encodeURIComponent(stored)}`, { scroll: false });
      }
    } catch { /* noop */ }
  }, [urlBank, banksLoading, banks, router]);

  const handleSelectBank = useCallback((slug: string) => {
    router.replace(`/learn/vocab?bank=${encodeURIComponent(slug)}`, { scroll: false });
  }, [router]);

  const handleBankCreated = useCallback((bank: VocabBank) => {
    setShowCreateModal(false);
    mutateBanks();
    router.replace(`/learn/vocab?bank=${encodeURIComponent(bank.slug)}`, { scroll: false });
    setTab("add");
  }, [mutateBanks, router]);

  // Streak for active bank, fed into the page-header pill.
  const { data: streakData } = useSWR<{ streaks: BankStreak[] }>(
    "/api/vocab/streak",
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const activeStreak: BankStreak | null = useMemo(() => {
    if (!activeBank) return null;
    const found = streakData?.streaks?.find(s => s.bank_id === activeBank.id);
    return found ?? { bank_id: activeBank.id, bank_name: activeBank.name, count: 0, lastDay: null };
  }, [streakData, activeBank]);

  const noBanks = !banksLoading && banks.length === 0;

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
                Learn / Word Banks
              </p>
              <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-[0.08em] leading-none">
                Word Banks
              </h1>
              <p className="font-syne text-sm text-cream/65 mt-2 max-w-md">
                Make a bank for anything. Add terms, write your own definitions, lock them in.
              </p>
            </div>
            {activeBank && activeStreak && (
              <BankStreakPill
                streak={activeStreak}
                color={activeBank.color}
                icon={activeBank.kind === "language" ? activeBank.icon : undefined}
                size="sm"
              />
            )}
          </header>

          {/* Empty state — zero banks */}
          {noBanks ? (
            <EmptyBanksState onCreate={() => setShowCreateModal(true)} />
          ) : banksLoading && banks.length === 0 ? (
            <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-10 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.25em] text-cream/55">loading banks...</p>
            </div>
          ) : activeBank ? (
            <>
              {/* Bank selector */}
              <section className="mb-5 animate-slide-up" style={{ animationDelay: "0.02s" }}>
                <BankSelector
                  banks={banks}
                  activeSlug={activeBank.slug}
                  onSelect={handleSelectBank}
                  onCreateClick={() => setShowCreateModal(true)}
                  onMutated={() => mutateBanks()}
                />
              </section>

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
                {tab === "add" && <AddWordForm bank={activeBank} />}
                {tab === "review" && <ReviewQueue bank={activeBank} />}
                {tab === "list" && <VocabList bank={activeBank} />}
              </section>
            </>
          ) : null}
        </div>
      </div>

      {/* Create-bank modal */}
      <CreateBankModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleBankCreated}
      />
    </ProtectedRoute>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────── */

function EmptyBanksState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-7 sm:p-9 text-center animate-slide-up">
      <p className="font-bebas text-2xl tracking-wider text-cream mb-2">
        Make your first word bank
      </p>
      <p className="font-syne text-sm text-cream/65 mb-7 max-w-md mx-auto">
        A bank is a focused stack of terms with their own streak. Make one per subject or per language.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto">
        <button
          type="button"
          onClick={onCreate}
          className="press-feedback group rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.08] hover:border-gold/40 transition-colors p-5 text-left"
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(255,215,0,0.14)", border: "1px solid rgba(255,215,0,0.35)" }}>
            <BookOpen size={20} weight="fill" color="#FFD700" aria-hidden="true" />
          </div>
          <p className="font-bebas text-lg tracking-wider text-cream mb-1">General bank</p>
          <p className="font-syne text-xs text-cream/65 leading-relaxed">
            Term study. AWS, math, biology, anything.
          </p>
        </button>
        <button
          type="button"
          onClick={onCreate}
          className="press-feedback group rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.08] hover:border-electric/40 transition-colors p-5 text-left"
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(74,144,217,0.14)", border: "1px solid rgba(74,144,217,0.35)" }}>
            <GlobeHemisphereWest size={20} weight="fill" color="#4A90D9" aria-hidden="true" />
          </div>
          <p className="font-bebas text-lg tracking-wider text-cream mb-1">Language bank</p>
          <p className="font-syne text-xs text-cream/65 leading-relaxed">
            Translate + active recall. Spanish, English, more soon.
          </p>
        </button>
      </div>
    </div>
  );
}
