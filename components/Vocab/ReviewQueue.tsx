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
import { CheckCircle, XCircle, Confetti, ArrowClockwise } from "@phosphor-icons/react";
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
  const { data, isLoading, mutate } = useSWR<{ words: VocabWord[] }>(
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
        toastError(error ?? "Couldn't save that review. Try again.");
        return;
      }
      const nextIdx = idx + 1;
      if (nextIdx >= queue.length) {
        mutate();
      }
      setIdx(nextIdx);
      setRevealed(false);
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Review failed.");
    } finally {
      setSubmitting(false);
    }
  };

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
            {remaining} of {queue.length} due
          </p>
        )}
      </div>

      {/* Card area */}
      {isLoading && !data ? (
        <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-cream/55">loading...</p>
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

  return (
    <div className="space-y-4 animate-slide-up" key={word.id}>
      <button
        type="button"
        onClick={onReveal}
        disabled={revealed}
        className="w-full rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-8 sm:p-12 text-center hover:bg-white/[0.07] transition-colors disabled:cursor-default"
        style={{ minHeight: 220 }}
        aria-label={revealed ? "Card revealed" : "Tap to reveal"}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/45 mb-3">
          {frontLabel}
        </p>
        <p className="font-bebas text-4xl sm:text-5xl tracking-wider text-cream leading-none">
          {front}
        </p>

        {revealed ? (
          <div className="mt-7 pt-6 border-t border-white/10 animate-slide-up">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-electric/80 mb-2">
              {backLabel}
            </p>
            <p
              className={isLanguageBank
                ? "font-bebas text-3xl tracking-wider text-electric leading-tight"
                : "font-syne text-base text-electric/95 leading-relaxed"}
            >
              {back}
            </p>
            {word.user_definition && (
              <div className="mt-5 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
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
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40 mt-6">
            tap to reveal
          </p>
        )}
      </button>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onAnswer(false)}
          disabled={!revealed || submitting}
          className="rounded-xl border border-red-400/40 bg-red-400/10 hover:bg-red-400/20 text-red-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors py-4 inline-flex items-center justify-center gap-2 font-syne font-bold"
        >
          <XCircle size={20} weight="fill" aria-hidden="true" />
          <span>Need more time</span>
        </button>
        <button
          type="button"
          onClick={() => onAnswer(true)}
          disabled={!revealed || submitting}
          className="rounded-xl border border-green-400/40 bg-green-400/10 hover:bg-green-400/20 text-green-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors py-4 inline-flex items-center justify-center gap-2 font-syne font-bold"
        >
          <CheckCircle size={20} weight="fill" aria-hidden="true" />
          <span>Got it</span>
        </button>
      </div>
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────── */

function EmptyReviewState({ bankName }: { bankName: string }) {
  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur border border-gold/25 p-10 text-center">
      <Confetti size={48} weight="fill" color="#FFD700" aria-hidden="true" className="mx-auto mb-4" />
      <p className="font-bebas text-2xl tracking-wider text-cream mb-2">
        All caught up in {bankName}!
      </p>
      <p className="font-syne text-sm text-cream/65">
        Come back tomorrow. Add a new term in the Add tab to keep your streak alive.
      </p>
      <div className="mt-5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45">
        <ArrowClockwise size={12} weight="bold" aria-hidden="true" />
        <span>queue refreshes when new terms come due</span>
      </div>
    </div>
  );
}
