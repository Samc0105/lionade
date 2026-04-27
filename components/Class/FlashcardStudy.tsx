"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import {
  Cards, ArrowRight, X, CheckCircle, Sparkle,
} from "@phosphor-icons/react";
import { apiPatch, swrFetcher } from "@/lib/api-client";
import { toastError } from "@/lib/toast";

/**
 * Per-class flashcard study widget.
 *
 * Compact entry pill on the class page → opens a full-screen modal that
 * walks the user through up to 20 due cards in priority order. Each card
 * gets four rate buttons (Again / Hard / Good / Easy) which PATCH the
 * server with the rating; the server recomputes SR state.
 *
 * Cards are picked client-side from the GET payload (sorted server-side
 * by next_due_at). Within the session we don't re-fetch — we just
 * advance through the queue we already have. After the session ends we
 * SWR-revalidate so the dueCount pill updates.
 */

interface Card {
  id: string;
  question: string;
  answer: string;
  source: "ai_note" | "manual";
  ease: number;
  intervalDays: number;
  nextDueAt: string;
  reviews: number;
  sourceNoteId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CardsResponse {
  cards: Card[];
  dueCount: number;
}

const SESSION_MAX = 20;

export default function FlashcardStudy({ classId }: { classId: string }) {
  const { data, isLoading, mutate } = useSWR<CardsResponse>(
    classId ? `/api/classes/${classId}/flashcards` : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const [open, setOpen] = useState(false);

  // Loading skeleton (compact — same height as the pill).
  if (isLoading && !data) {
    return (
      <section className="mt-10">
        <div className="h-12 w-full max-w-md rounded-[10px] bg-white/[0.04] animate-pulse" />
      </section>
    );
  }

  const cards = data?.cards ?? [];
  const dueCount = data?.dueCount ?? 0;
  const total = cards.length;

  // Empty state — encourage the user to add a real note.
  if (total === 0) {
    return (
      <section className="mt-10">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-bebas text-sm text-cream/85 tracking-[0.2em]">
            <span className="inline-flex items-center gap-2">
              <Cards size={13} weight="bold" /> FLASHCARDS
            </span>
          </h2>
        </div>
        <div className="rounded-[12px] border border-dashed border-white/[0.08] bg-white/[0.015] p-6 text-center">
          <Cards size={18} className="text-cream/30 mx-auto mb-2" />
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/40 mb-1">
            No flashcards yet
          </p>
          <p className="text-[12px] text-cream/40">
            Add a note (50+ chars) and Ninny will generate cards from it.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-bebas text-sm text-cream/85 tracking-[0.2em]">
          <span className="inline-flex items-center gap-2">
            <Cards size={13} weight="bold" /> FLASHCARDS
          </span>
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40">
          {total} card{total === 1 ? "" : "s"}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-3 rounded-full border border-electric/30
          bg-gradient-to-r from-electric/[0.08] to-transparent
          hover:border-electric/60 hover:bg-electric/[0.12]
          transition-all duration-200 px-4 py-2.5 active:scale-[0.99]"
      >
        <span className="grid place-items-center w-8 h-8 rounded-full bg-electric/[0.18] text-electric">
          <Cards size={14} weight="bold" />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-cream/85">
          Flashcards · <span className="text-electric">{dueCount} due</span> · Study
        </span>
        <ArrowRight
          size={13}
          weight="bold"
          className="text-electric opacity-60 group-hover:opacity-100 transition-opacity"
        />
      </button>

      {open && (
        <StudyModal
          cards={cards}
          classId={classId}
          onClose={() => {
            setOpen(false);
            void mutate();
          }}
        />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — one card at a time, four rate buttons after reveal
// ─────────────────────────────────────────────────────────────────────────────
type Rating = "again" | "hard" | "good" | "easy";

interface RatingMeta {
  rating: Rating;
  label: string;
  hint: string;
  base: string;
  hover: string;
  border: string;
  text: string;
}

const RATINGS: ReadonlyArray<RatingMeta> = [
  {
    rating: "again",
    label: "Again",
    hint: "Forgot",
    base: "rgba(239,68,68,0.10)",
    hover: "rgba(239,68,68,0.20)",
    border: "rgba(239,68,68,0.40)",
    text: "#FCA5A5",
  },
  {
    rating: "hard",
    label: "Hard",
    hint: "Slow",
    base: "rgba(245,158,11,0.10)",
    hover: "rgba(245,158,11,0.20)",
    border: "rgba(245,158,11,0.40)",
    text: "#FCD34D",
  },
  {
    rating: "good",
    label: "Good",
    hint: "Got it",
    base: "rgba(34,197,94,0.10)",
    hover: "rgba(34,197,94,0.20)",
    border: "rgba(34,197,94,0.40)",
    text: "#86EFAC",
  },
  {
    rating: "easy",
    label: "Easy",
    hint: "Trivial",
    base: "rgba(74,144,217,0.10)",
    hover: "rgba(74,144,217,0.20)",
    border: "rgba(74,144,217,0.40)",
    text: "#93C5FD",
  },
];

function StudyModal({
  cards, classId, onClose,
}: {
  cards: Card[];
  classId: string;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion();

  // Snapshot the queue at modal-open: take the first SESSION_MAX cards,
  // already sorted server-side by next_due_at. We never re-fetch mid-session.
  const queue = useMemo(() => cards.slice(0, SESSION_MAX), [cards]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<{ rated: number; correct: number }>({
    rated: 0, correct: 0,
  });
  const [done, setDone] = useState(false);
  // Guard against double-clicks racing through multiple cards.
  const lockRef = useRef(false);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Edge case: empty queue (shouldn't happen — entry pill is hidden when
  // cards.length === 0 — but defend anyway).
  useEffect(() => {
    if (queue.length === 0) setDone(true);
  }, [queue.length]);

  const card = queue[idx];
  const sessionLength = queue.length;

  const advance = () => {
    if (idx + 1 >= sessionLength) {
      // Last card — show summary instead of advancing past the end.
      setDone(true);
    } else {
      setIdx(i => i + 1);
      setRevealed(false);
    }
  };

  const onRate = async (rating: Rating) => {
    if (!card) return;
    if (lockRef.current || submitting) return;
    lockRef.current = true;
    setSubmitting(true);

    try {
      const r = await apiPatch<{ card: Card }>(
        `/api/classes/${classId}/flashcards/${card.id}`,
        { rating },
      );
      if (!r.ok) {
        toastError(r.error || "Couldn't save rating.");
        // Even on failure, advance — don't trap the user on a broken card.
      }
      setResults(prev => ({
        rated: prev.rated + 1,
        correct: prev.correct + (rating === "good" || rating === "easy" ? 1 : 0),
      }));
      advance();
    } finally {
      setSubmitting(false);
      lockRef.current = false;
    }
  };

  // Keyboard shortcuts: space/enter reveals, 1-4 rates after reveal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      if (e.key === "Escape") { onClose(); return; }
      if (!revealed) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          setRevealed(true);
        }
        return;
      }
      const map: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
      const rating = map[e.key];
      if (rating) {
        e.preventDefault();
        void onRate(rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, done, idx]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-xl rounded-[14px] border border-electric/30
        bg-gradient-to-br from-navy to-[#0a0f1d] p-5 sm:p-6 shadow-2xl animate-slide-up">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 grid place-items-center w-7 h-7 rounded-full
            text-cream/40 hover:text-cream hover:bg-white/[0.05]"
        >
          <X size={14} weight="bold" />
        </button>

        {!done && card && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Cards size={14} className="text-electric" weight="bold" />
              <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-electric">
                Flashcards · {idx + 1} / {sessionLength}
              </span>
            </div>

            {/* Progress bar */}
            <div className="flex gap-1 mb-6">
              {queue.map((_, i) => (
                <div
                  key={i}
                  className="h-1 flex-1 rounded-full transition-colors"
                  style={{
                    background: i < idx
                      ? "#4A90D9"
                      : i === idx
                        ? "#4A90D980"
                        : "rgba(255,255,255,0.08)",
                  }}
                />
              ))}
            </div>

            {/* Question card */}
            <div
              className="rounded-[12px] border px-5 py-6 sm:py-8 mb-4"
              style={{
                borderColor: "rgba(168,85,247,0.40)",
                background: "linear-gradient(135deg, rgba(168,85,247,0.08), rgba(168,85,247,0.02))",
              }}
            >
              <p
                className="font-mono text-[10px] tracking-widest uppercase mb-3"
                style={{ color: "#A855F7" }}
              >
                Question
              </p>
              <p className="font-syne text-cream text-[16px] sm:text-[18px] leading-relaxed">
                {card.question}
              </p>
            </div>

            {/* Answer card (revealed) */}
            {revealed ? (
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="rounded-[12px] border px-5 py-5 mb-5"
                style={{
                  borderColor: "rgba(255,215,0,0.40)",
                  background: "linear-gradient(135deg, rgba(255,215,0,0.08), rgba(255,215,0,0.02))",
                }}
              >
                <p className="font-mono text-[10px] tracking-widest uppercase mb-2 text-gold">
                  Answer
                </p>
                <p className="font-syne text-cream/95 text-[14.5px] leading-relaxed">
                  {card.answer}
                </p>
              </motion.div>
            ) : (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="w-full rounded-[12px] border border-white/[0.12] hover:border-white/[0.25]
                  bg-white/[0.02] hover:bg-white/[0.05] transition-colors py-4 mb-5
                  font-mono text-[11px] uppercase tracking-[0.25em] text-cream/70 hover:text-cream"
              >
                Show answer · space
              </button>
            )}

            {/* Rate buttons */}
            {revealed && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {RATINGS.map((r, i) => (
                  <motion.button
                    key={r.rating}
                    type="button"
                    onClick={() => void onRate(r.rating)}
                    disabled={submitting}
                    whileHover={reducedMotion ? undefined : { y: -1 }}
                    whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                    className="flex flex-col items-center gap-0.5 rounded-[10px] border py-2.5
                      transition-colors disabled:cursor-wait disabled:opacity-60"
                    style={{
                      background: r.base,
                      borderColor: r.border,
                      color: r.text,
                    }}
                  >
                    <span className="font-bebas text-[15px] tracking-wider leading-none">
                      {r.label}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] opacity-70">
                      {i + 1} · {r.hint}
                    </span>
                  </motion.button>
                ))}
              </div>
            )}

            <p className="mt-4 font-mono text-[9.5px] uppercase tracking-[0.22em] text-cream/30 text-center">
              {revealed ? "1-4 to rate" : "Space to reveal · Esc to close"}
            </p>
          </>
        )}

        {done && (
          <FlashcardSummary
            rated={results.rated}
            sessionLength={sessionLength}
            correct={results.correct}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function FlashcardSummary({
  rated, sessionLength, correct, onClose,
}: {
  rated: number;
  sessionLength: number;
  correct: number;
  onClose: () => void;
}) {
  const noneStudied = rated === 0;
  const pct = rated > 0 ? Math.round((correct / rated) * 100) : 0;

  return (
    <div className="text-center py-3 animate-slide-up">
      <div className="flex justify-center mb-3">
        {noneStudied
          ? <Cards size={42} weight="bold" className="text-cream/40" />
          : pct >= 80
            ? <CheckCircle size={42} weight="fill" className="text-[#22C55E]" />
            : <Sparkle size={42} weight="fill" className="text-electric" />}
      </div>
      <h3 className="font-bebas text-[36px] tracking-wider text-cream leading-none mb-1">
        {noneStudied ? "ALL DONE" : pct >= 80 ? "STRONG SESSION" : "GOOD WORK"}
      </h3>
      <p className="text-cream/60 text-[14px] mb-5">
        {noneStudied
          ? "Nothing to review right now."
          : <>You rated <span className="text-cream font-bold">{rated}</span> of {sessionLength} cards · {pct}% felt easy or good</>}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full bg-electric text-white hover:bg-electric/90
          font-mono text-[11px] uppercase tracking-[0.25em] py-3 px-8 transition-colors"
      >
        Close
      </button>
    </div>
  );
}
