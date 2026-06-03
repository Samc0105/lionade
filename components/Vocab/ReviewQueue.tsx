"use client";

/**
 * ReviewQueue — Tab B of /learn/vocab.
 *
 * Flashcard flow over the due-words list returned by GET /api/vocab/words?due=true.
 * One card at a time. Tap to flip → reveal the translation + the user's own
 * definition. Two big buttons: Got it / Need more time. Each tap POSTs the
 * review and animates the next card in.
 *
 * Streak pill renders at the top so the user sees their language streak as the
 * social proof for showing up today.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { CheckCircle, XCircle, Confetti, ArrowClockwise } from "@phosphor-icons/react";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { toastError } from "@/lib/toast";
import LanguageStreakPill, { type LangPair, type LanguageStreak } from "./LanguageStreakPill";

export interface VocabWord {
  id: string;
  word: string;
  translation: string;
  source_lang: string;
  target_lang: string;
  user_definition: string;
  review_count: number;
  correct_count: number;
  next_review_at: string;
}

interface Props {
  /** Active lang pair from the parent — used to scope the GET and pick the right streak pill. */
  langPair: LangPair;
}

export default function ReviewQueue({ langPair }: Props) {
  const { data, isLoading, mutate } = useSWR<{ words: VocabWord[] }>(
    `/api/vocab/words?lang=${langPair}&due=true`,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const { data: streakData } = useSWR<LanguageStreak[]>(
    "/api/vocab/streak",
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const queue = useMemo(() => data?.words ?? [], [data]);
  const streak = useMemo(
    () => streakData?.find(s => s.langPair === langPair) ?? { langPair, count: 0, lastDay: null },
    [streakData, langPair],
  );

  // Index into queue. We DON'T mutate the queue itself between answers — we
  // just advance the index, so re-renders don't cause cards to jump around.
  // On reaching the end we trigger SWR to refetch for any newly-due cards.
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // When the queue identity changes (lang switch, fresh fetch), reset to top.
  useEffect(() => {
    setIdx(0);
    setRevealed(false);
  }, [queue.length, langPair]);

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
      // Advance. If we've consumed the queue, kick a refetch so newly-due
      // cards roll in.
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
      <div className="flex items-center justify-between">
        <LanguageStreakPill streak={streak} size="md" />
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
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onAnswer={handleAnswer}
          submitting={submitting}
        />
      ) : (
        <EmptyReviewState />
      )}
    </div>
  );
}

/* ── FlashCard ─────────────────────────────────────────────────────────── */

interface FlashCardProps {
  word: VocabWord;
  revealed: boolean;
  onReveal: () => void;
  onAnswer: (correct: boolean) => void;
  submitting: boolean;
}

function FlashCard({ word, revealed, onReveal, onAnswer, submitting }: FlashCardProps) {
  return (
    <div className="space-y-4 animate-slide-up" key={word.id}>
      <button
        type="button"
        onClick={onReveal}
        disabled={revealed}
        className="w-full rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-8 sm:p-12 text-center hover:bg-white/[0.07] transition-colors disabled:cursor-default"
        style={{ minHeight: 220 }}
        aria-label={revealed ? "Card revealed" : "Tap to reveal translation"}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/45 mb-3">
          {word.source_lang === "en" ? "english" : "spanish"}
        </p>
        <p className="font-bebas text-4xl sm:text-5xl tracking-wider text-cream leading-none">
          {word.word}
        </p>

        {revealed ? (
          <div className="mt-7 pt-6 border-t border-white/10 animate-slide-up">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-electric/80 mb-2">
              {word.target_lang === "en" ? "english" : "spanish"}
            </p>
            <p className="font-bebas text-3xl tracking-wider text-electric leading-tight">
              {word.translation}
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

      {/* Action buttons — only enabled once revealed */}
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

function EmptyReviewState() {
  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur border border-gold/25 p-10 text-center">
      <Confetti size={48} weight="fill" color="#FFD700" aria-hidden="true" className="mx-auto mb-4" />
      <p className="font-bebas text-2xl tracking-wider text-cream mb-2">
        All caught up!
      </p>
      <p className="font-syne text-sm text-cream/65">
        Come back tomorrow. Add a new word in the Add tab to keep your streak alive.
      </p>
      <div className="mt-5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45">
        <ArrowClockwise size={12} weight="bold" aria-hidden="true" />
        <span>queue refreshes when new words come due</span>
      </div>
    </div>
  );
}
