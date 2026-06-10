"use client";

/**
 * ReviewQueue — Tab B of /learn/vocab.
 *
 * Flashcard flow over the due-words list for the ACTIVE BANK, returned by
 * GET /api/vocab/words?bank_id=<uuid>&due=true. One card at a time. Tap to
 * flip → reveal the back of the card. Two big buttons: Got it / Need more time.
 *
 * Card front renders `word` OR `term` (same database field per backend
 * contract — language banks store the source-language word; general banks
 * store the term). Card back renders translation OR term_definition + the
 * user's own self-definition. The component is bank-kind agnostic at render
 * time except for the small "source / target" labels.
 *
 * Streak pill at the top is per-bank, sourced from /api/vocab/streak.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { CheckCircle, XCircle, Confetti, ArrowClockwise, PlusCircle } from "@phosphor-icons/react";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { toastError } from "@/lib/toast";
import BankStreakPill, { type BankStreak } from "./BankStreakPill";
import type { VocabBank } from "./CreateBankModal";

export interface VocabWord {
  id: string;
  bank_id: string;
  /** Source-language word (language banks) or the canonical term (general banks). */
  word?: string;
  term?: string;
  /** Target-language translation — language banks only. */
  translation?: string;
  /** Reference definition — general banks only. */
  term_definition?: string;
  source_lang?: string;
  target_lang?: string;
  user_definition: string;
  review_count: number;
  correct_count: number;
  next_review_at: string;
  /** User-set confidence override. null = auto-derive from accuracy. */
  self_confidence?: "confident" | "shaky" | "struggling" | null;
}

interface Props {
  bank: VocabBank;
}

export default function ReviewQueue({ bank }: Props) {
  const { data, error, isLoading, mutate } = useSWR<{ words: VocabWord[] }>(
    `/api/vocab/words?bank_id=${encodeURIComponent(bank.id)}&due=true`,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const { data: streakData } = useSWR<{ streaks: BankStreak[] }>(
    "/api/vocab/streak",
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const queue = useMemo(() => data?.words ?? [], [data]);

  // An empty due-queue is ambiguous: "all reviewed" vs "this bank has no
  // words at all" (a brand-new bank). The celebration copy is wrong for the
  // second case, so when the due fetch resolves empty we check the bank's
  // total word count. Same SWR key as VocabList's full fetch, so if the user
  // has visited the List tab this resolves from cache with no extra request.
  const dueQueueEmpty = data !== undefined && queue.length === 0;
  const { data: allWordsData } = useSWR<{ words: VocabWord[] }>(
    dueQueueEmpty ? `/api/vocab/words?bank_id=${encodeURIComponent(bank.id)}` : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  );
  const bankIsEmpty = dueQueueEmpty && allWordsData !== undefined && allWordsData.words.length === 0;
  // Until the total-count check resolves we don't know WHICH empty state is
  // right, so keep the skeleton up rather than flashing the celebration at a
  // brand-new bank.
  const emptyStateUnresolved = dueQueueEmpty && allWordsData === undefined;
  const streak: BankStreak = useMemo(() => {
    const found = streakData?.streaks?.find(s => s.bank_id === bank.id);
    return found ?? { bank_id: bank.id, bank_name: bank.name, count: 0, lastDay: null };
  }, [streakData, bank.id, bank.name]);

  // Index into queue. We DON'T mutate the queue itself between answers — we
  // just advance the index, so re-renders don't cause cards to jump around.
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // When the queue identity changes (bank switch, fresh fetch), reset to top.
  useEffect(() => {
    setIdx(0);
    setRevealed(false);
  }, [queue.length, bank.id]);

  const current = queue[idx] ?? null;
  const remaining = Math.max(0, queue.length - idx);

  const handleAnswer = async (correct: boolean) => {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      const { ok, error } = await apiPost<{ next_review_at: string; ease_factor: number }>(
        `/api/vocab/review/${current.id}`,
        { correct },
      );
      if (!ok) {
        console.error("[vocab:review] failed", error);
        toastError("Couldn't save that review. Try again.");
        return;
      }
      const nextIdx = idx + 1;
      if (nextIdx >= queue.length) {
        mutate();
      }
      setIdx(nextIdx);
      setRevealed(false);
    } catch (e: unknown) {
      console.error("[vocab:review] threw", e);
      toastError("Couldn't save that review. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const reviewed = queue.length > 0 ? queue.length - remaining : 0;
  const progressPct = queue.length > 0 ? Math.min(100, (reviewed / queue.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Streak pill — front and center */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <BankStreakPill
          streak={streak}
          color={bank.color}
          icon={bank.kind === "language" ? bank.icon : undefined}
          size="md"
        />
        {queue.length > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 tabular-nums">
            {reviewed} of {queue.length} reviewed
          </p>
        )}
      </div>

      {/* Progress bar — shows how far through today's queue */}
      {queue.length > 0 && (
        <div
          className="h-1 rounded-full bg-white/[0.05] overflow-hidden"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${progressPct}%`,
              background: "linear-gradient(90deg, #4A90D9 0%, #FFD700 100%)",
              transition: "width 0.5s cubic-bezier(0.16,1,0.3,1)",
              willChange: "width",
            }}
          />
        </div>
      )}

      {/* Card area */}
      {(isLoading && !data) || emptyStateUnresolved ? (
        <div className="rounded-2xl bg-white/[0.03] backdrop-blur border border-white/[0.06] p-10 flex flex-col items-center gap-5 animate-pulse">
          <div className="h-3 w-24 rounded-full bg-white/[0.05]" />
          <div className="h-10 w-64 rounded-md bg-white/[0.07]" />
          <div className="h-3 w-40 rounded bg-white/[0.04]" />
          <div className="flex gap-3 mt-3">
            <div className="h-9 w-24 rounded-full bg-white/[0.04]" />
            <div className="h-9 w-24 rounded-full bg-white/[0.04]" />
          </div>
        </div>
      ) : current ? (
        <FlashCard
          word={current}
          bank={bank}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onAnswer={handleAnswer}
          submitting={submitting}
        />
      ) : error && !data ? (
        /* Fetch failed with nothing cached — without this branch the chain
           falls through to the celebration EmptyReviewState, which lies.
           Same red-glass retry treatment as DiscoverTab's ErrorState. */
        <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-7 text-center animate-slide-up">
          <p className="font-syne text-sm text-red-300 mb-3">
            Couldn&apos;t load your review queue. Your words are safe.
          </p>
          <button
            type="button"
            onClick={() => mutate()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors"
          >
            <ArrowClockwise size={12} weight="bold" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : bankIsEmpty ? (
        <EmptyBankState bankName={bank.name} />
      ) : (
        <EmptyReviewState bankName={bank.name} />
      )}
    </div>
  );
}

/* ── FlashCard ─────────────────────────────────────────────────────────── */

interface FlashCardProps {
  word: VocabWord;
  bank: VocabBank;
  revealed: boolean;
  onReveal: () => void;
  onAnswer: (correct: boolean) => void;
  submitting: boolean;
}

function FlashCard({ word, bank, revealed, onReveal, onAnswer, submitting }: FlashCardProps) {
  const isLanguageBank = bank.kind === "language";
  const front = isLanguageBank ? (word.word ?? word.term ?? "") : (word.term ?? word.word ?? "");
  const back = isLanguageBank ? word.translation ?? "" : word.term_definition ?? "";
  const frontLabel = isLanguageBank
    ? (word.source_lang === "en" ? "english" : word.source_lang === "es" ? "spanish" : word.source_lang ?? "term")
    : "term";
  const backLabel = isLanguageBank
    ? (word.target_lang === "en" ? "english" : word.target_lang === "es" ? "spanish" : word.target_lang ?? "translation")
    : "definition";

  const promptCopy = isLanguageBank ? "What does it mean?" : "Recall the definition.";

  return (
    <div className="space-y-4 animate-slide-up" key={word.id}>
      <button
        type="button"
        onClick={onReveal}
        disabled={revealed}
        className="vocab-flashcard w-full rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-8 sm:p-14 text-center hover:bg-white/[0.07] hover:border-white/15 transition-[background-color,border-color] disabled:cursor-default"
        style={{ minHeight: 240 }}
        aria-label={revealed ? "Card revealed" : "Tap to reveal"}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-cream/45 mb-4">
          {frontLabel}
        </p>
        <p className="font-bebas text-5xl sm:text-6xl tracking-[0.04em] text-cream leading-[0.95]">
          {front}
        </p>

        {revealed ? (
          <div className="mt-8 pt-6 border-t border-white/10 vocab-reveal">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-electric/80 mb-2">
              {backLabel}
            </p>
            <p
              className={isLanguageBank
                ? "font-bebas text-3xl sm:text-4xl tracking-wider text-electric leading-tight"
                : "font-syne text-base sm:text-lg text-electric/95 leading-relaxed"}
            >
              {back}
            </p>
            {word.user_definition && (
              <div className="mt-5 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-left mx-auto max-w-md">
                <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-gold/70 mb-1">
                  your definition
                </p>
                <p className="font-syne text-sm text-cream/85 leading-relaxed">
                  {word.user_definition}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-7">
            <p className="font-syne text-sm text-cream/55 italic">
              {promptCopy}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/35 mt-3">
              tap to reveal
            </p>
          </div>
        )}
      </button>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onAnswer(false)}
          disabled={!revealed || submitting}
          className="rounded-xl border border-red-400/40 bg-red-400/10 hover:bg-red-400/20 hover:border-red-400/60 text-red-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors py-4 inline-flex items-center justify-center gap-2 font-syne font-bold"
        >
          <XCircle size={20} weight="fill" aria-hidden="true" />
          <span>Need more time</span>
        </button>
        <button
          type="button"
          onClick={() => onAnswer(true)}
          disabled={!revealed || submitting}
          className="rounded-xl border border-green-400/40 bg-green-400/10 hover:bg-green-400/20 hover:border-green-400/60 text-green-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors py-4 inline-flex items-center justify-center gap-2 font-syne font-bold"
        >
          <CheckCircle size={20} weight="fill" aria-hidden="true" />
          <span>Got it</span>
        </button>
      </div>

      <style jsx>{`
        @keyframes vocab-reveal {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .vocab-reveal {
          animation: vocab-reveal 0.36s cubic-bezier(0.16,1,0.3,1) both;
          will-change: opacity, transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .vocab-reveal { animation: none; }
        }
      `}</style>
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────── */

/** Brand-new bank with zero words: onboarding nudge, not a celebration. */
function EmptyBankState({ bankName }: { bankName: string }) {
  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur border border-electric/25 p-10 text-center animate-slide-up">
      <PlusCircle size={52} weight="fill" color="#00BFFF" aria-hidden="true" className="mx-auto mb-4" />
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-electric/75 mb-2">
        Fresh bank
      </p>
      <p className="font-bebas text-3xl tracking-[0.06em] text-cream mb-2 leading-none">
        {bankName} is empty
      </p>
      <p className="font-syne text-sm text-cream/65 max-w-md mx-auto leading-relaxed">
        Drop your first word in the Add tab and it lands here for review. The grind starts with one term.
      </p>
    </div>
  );
}

function EmptyReviewState({ bankName }: { bankName: string }) {
  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur border border-gold/25 p-10 text-center animate-slide-up">
      <Confetti size={52} weight="fill" color="#FFD700" aria-hidden="true" className="mx-auto mb-4" />
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/75 mb-2">
        You are caught up
      </p>
      <p className="font-bebas text-3xl tracking-[0.06em] text-cream mb-2 leading-none">
        Nothing to review in {bankName}
      </p>
      <p className="font-syne text-sm text-cream/65 max-w-md mx-auto leading-relaxed">
        Come back tomorrow. Or add a new term in the Add tab to keep your streak alive.
      </p>
      <div className="mt-5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45">
        <ArrowClockwise size={12} weight="bold" aria-hidden="true" />
        <span>queue refreshes when new terms come due</span>
      </div>
    </div>
  );
}
