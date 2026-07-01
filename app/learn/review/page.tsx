"use client";

// Review Your Weak Spots — spaced-repetition drill over the questions the user
// has previously missed (ninny_wrong_answers). Server decides which items are
// DUE and grades every answer server-side. On mastery an item stops resurfacing.
//
// Two item shapes:
//   - mcq: reconstructed real 4-option question (options recovered from the
//     source material). Graded on the chosen index server-side.
//   - flashcard: question came from a mode with no recoverable option set; shown
//     as a reveal card, honest self-grade ("I knew it" / "Missed it"). No Fangs
//     are at stake anywhere in this mode, so self-grading can't be gamed.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  Target,
  ArrowRight,
  CheckCircle,
  XCircle,
  Sparkle,
  ArrowClockwise,
  Eye,
} from "@phosphor-icons/react";

const PURPLE = "#A855F7";

interface ReviewMcqItem {
  kind: "mcq";
  id: string;
  materialId: string;
  materialTitle: string | null;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  missCount: number;
}
interface ReviewFlashcardItem {
  kind: "flashcard";
  id: string;
  materialId: string;
  materialTitle: string | null;
  question: string;
  correctAnswer: string;
  missCount: number;
}
type ReviewItem = ReviewMcqItem | ReviewFlashcardItem;

interface ReviewResponse {
  items: ReviewItem[];
  dueCount: number;
  totalWeakSpots: number;
  nextDueInMs: number | null;
}

type Phase = "loading" | "empty" | "active" | "done";

interface GradeResult {
  success: boolean;
  correct: boolean;
  mastered: boolean;
}

/* ── Countdown formatting for the "all caught up" state ───────── */
function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"}`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default function ReviewPage() {
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [meta, setMeta] = useState<{ dueCount: number; totalWeakSpots: number; nextDueInMs: number | null }>({
    dueCount: 0,
    totalWeakSpots: 0,
    nextDueInMs: null,
  });

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null); // mcq choice
  const [revealed, setRevealed] = useState(false); // flashcard flip
  const [grading, setGrading] = useState(false);
  const [lastResult, setLastResult] = useState<GradeResult | null>(null);

  // Session tally
  const [reviewed, setReviewed] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);

  const load = useCallback(async () => {
    setPhase("loading");
    const res = await apiGet<ReviewResponse>("/api/ninny/review?limit=15");
    if (res.ok && res.data) {
      setItems(res.data.items);
      setMeta({
        dueCount: res.data.dueCount,
        totalWeakSpots: res.data.totalWeakSpots,
        nextDueInMs: res.data.nextDueInMs,
      });
      setIndex(0);
      setSelected(null);
      setRevealed(false);
      setLastResult(null);
      setReviewed(0);
      setCorrectCount(0);
      setMasteredCount(0);
      setPhase(res.data.items.length > 0 ? "active" : "empty");
    } else {
      setItems([]);
      setMeta({ dueCount: 0, totalWeakSpots: 0, nextDueInMs: null });
      setPhase("empty");
    }
  }, []);

  useEffect(() => {
    if (user?.id) load();
  }, [user?.id, load]);

  const current = items[index];

  /* ── Grade the current item ─────────────────────────────────── */
  const submitGrade = useCallback(
    async (payload: { selectedIndex?: number; knewIt?: boolean }) => {
      if (!current || grading) return;
      setGrading(true);
      const res = await apiPost<GradeResult>("/api/ninny/review/grade", {
        id: current.id,
        ...payload,
      });
      setGrading(false);
      if (res.ok && res.data) {
        setLastResult(res.data);
        setReviewed((n) => n + 1);
        if (res.data.correct) setCorrectCount((n) => n + 1);
        if (res.data.mastered) setMasteredCount((n) => n + 1);
      } else {
        // Grade failed — surface a soft inline result so the flow isn't stuck.
        setLastResult({ success: false, correct: false, mastered: false });
      }
    },
    [current, grading],
  );

  const handleSelectOption = (i: number) => {
    if (selected !== null || grading) return;
    setSelected(i);
    void submitGrade({ selectedIndex: i });
  };

  const handleSelfGrade = (knewIt: boolean) => {
    if (lastResult || grading) return;
    void submitGrade({ knewIt });
  };

  const handleNext = () => {
    const next = index + 1;
    if (next >= items.length) {
      setPhase("done");
      return;
    }
    setIndex(next);
    setSelected(null);
    setRevealed(false);
    setLastResult(null);
  };

  const progressPct = items.length > 0 ? ((index + (lastResult ? 1 : 0)) / items.length) * 100 : 0;

  return (
    <ProtectedRoute>
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.4s var(--ease-out-expo, cubic-bezier(0.16,1,0.3,1)) both; }
        @media (prefers-reduced-motion: reduce) {
          .animate-slide-up { animation: none; }
        }
      `}</style>

      <FeatureGate feature="learn">
        <div className="min-h-screen pt-16 pb-20 md:pb-8">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

            {/* Header */}
            <header className="mb-6 flex items-center justify-between animate-slide-up">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${PURPLE}18`, border: `1px solid ${PURPLE}40` }}
                >
                  <Target size={20} weight="fill" color={PURPLE} aria-hidden="true" />
                </div>
                <div>
                  <h1 className="font-bebas text-2xl sm:text-3xl text-cream tracking-[0.06em] leading-none">
                    Review Weak Spots
                  </h1>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55 mt-1">
                    spaced repetition
                  </p>
                </div>
              </div>
              <Link
                href="/learn"
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/50 hover:text-cream/80 transition-colors"
              >
                exit
              </Link>
            </header>

            {/* LOADING */}
            {phase === "loading" && (
              <div className="space-y-3 animate-slide-up" aria-hidden="true">
                <div className="h-2 rounded-full bg-white/[0.05]" />
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] h-40" />
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] h-12" />
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] h-12" />
              </div>
            )}

            {/* EMPTY — nothing due (or no weak spots at all) */}
            {phase === "empty" && (
              <div className="text-center py-14 animate-slide-up">
                <div
                  className="w-16 h-16 rounded-full inline-flex items-center justify-center mb-5"
                  style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)" }}
                >
                  <CheckCircle size={32} weight="fill" color="#22C55E" aria-hidden="true" />
                </div>
                {meta.totalWeakSpots === 0 ? (
                  <>
                    <p className="font-bebas text-2xl text-cream tracking-wide mb-2">Nothing to review yet</p>
                    <p className="text-cream/60 text-sm font-syne mb-6 max-w-sm mx-auto leading-relaxed">
                      When you miss questions in a Ninny study session, they land here so you can
                      drill them until they stick.
                    </p>
                    <Link
                      href="/learn/ninny"
                      className="inline-flex items-center gap-2 font-bebas text-base tracking-wider px-6 py-3 rounded-xl transition-all active:scale-[0.99] hover:brightness-110"
                      style={{ background: `${PURPLE}25`, border: `1px solid ${PURPLE}60`, color: "#EEF4FF" }}
                    >
                      Study with Ninny
                      <ArrowRight size={16} weight="bold" aria-hidden="true" />
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="font-bebas text-2xl text-cream tracking-wide mb-2">All caught up</p>
                    <p className="text-cream/60 text-sm font-syne mb-6 max-w-sm mx-auto leading-relaxed">
                      You have {meta.totalWeakSpots} weak spot{meta.totalWeakSpots === 1 ? "" : "s"} on your
                      radar, but none are due right now.
                      {meta.nextDueInMs != null && (
                        <> The next one comes back in about {formatDuration(meta.nextDueInMs)}.</>
                      )}
                    </p>
                    <Link
                      href="/learn"
                      className="inline-flex items-center gap-2 font-bebas text-base tracking-wider px-6 py-3 rounded-xl transition-all active:scale-[0.99] hover:brightness-110"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#EEF4FF" }}
                    >
                      Back to Learn
                    </Link>
                  </>
                )}
              </div>
            )}

            {/* ACTIVE — the quiz loop */}
            {phase === "active" && current && (
              <div className="animate-slide-up" key={current.id}>
                {/* Progress bar + counter */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">
                      {index + 1} / {items.length}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: PURPLE }}>
                      missed {current.missCount}×
                    </p>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div
                      className="h-full"
                      style={{
                        width: `${progressPct}%`,
                        background: `linear-gradient(90deg, ${PURPLE}80, ${PURPLE})`,
                        transition: reduceMotion ? "none" : "width 400ms var(--ease-out-emil, cubic-bezier(0.16,1,0.3,1))",
                      }}
                    />
                  </div>
                </div>

                {/* Material tag */}
                {current.materialTitle && (
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/40 mb-2 truncate">
                    {current.materialTitle}
                  </p>
                )}

                {/* Question card */}
                <div
                  className="rounded-2xl border p-5 sm:p-6 mb-4"
                  style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
                >
                  <p className="font-syne text-cream text-lg leading-snug">{current.question}</p>
                </div>

                {/* ── MCQ options ── */}
                {current.kind === "mcq" && (
                  <div className="space-y-2.5">
                    {current.options.map((opt, i) => {
                      const isChosen = selected === i;
                      const isCorrect = i === current.correctIndex;
                      const answered = selected !== null;
                      // Color states: after answering, correct=green, chosen-wrong=red.
                      let bg = "rgba(255,255,255,0.03)";
                      let border = "rgba(255,255,255,0.08)";
                      let text = "#EEF4FF";
                      if (answered) {
                        if (isCorrect) {
                          bg = "rgba(34,197,94,0.12)";
                          border = "rgba(34,197,94,0.5)";
                          text = "#EEF4FF";
                        } else if (isChosen) {
                          bg = "rgba(239,68,68,0.12)";
                          border = "rgba(239,68,68,0.5)";
                          text = "#EEF4FF";
                        } else {
                          text = "rgba(238,244,255,0.4)";
                        }
                      }
                      return (
                        <button
                          key={i}
                          type="button"
                          disabled={answered || grading}
                          onClick={() => handleSelectOption(i)}
                          className="w-full text-left rounded-xl border px-4 py-3.5 min-h-[52px] font-syne text-sm transition-all duration-200 disabled:cursor-default flex items-center gap-3 hover:brightness-110"
                          style={{ background: bg, borderColor: border, color: text }}
                        >
                          <span
                            className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center font-mono text-[11px]"
                            style={{
                              background: "rgba(255,255,255,0.06)",
                              color: answered && isCorrect ? "#22C55E" : answered && isChosen ? "#EF4444" : "rgba(238,244,255,0.6)",
                            }}
                          >
                            {String.fromCharCode(65 + i)}
                          </span>
                          <span className="flex-1">{opt}</span>
                          {answered && isCorrect && <CheckCircle size={18} weight="fill" color="#22C55E" aria-hidden="true" />}
                          {answered && isChosen && !isCorrect && <XCircle size={18} weight="fill" color="#EF4444" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ── Flashcard reveal ── */}
                {current.kind === "flashcard" && (
                  <div>
                    {!revealed ? (
                      <button
                        type="button"
                        onClick={() => setRevealed(true)}
                        className="w-full rounded-xl border px-4 py-4 min-h-[52px] font-bebas text-base tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110"
                        style={{ background: `${PURPLE}18`, borderColor: `${PURPLE}45`, color: "#EEF4FF" }}
                      >
                        <Eye size={18} weight="fill" aria-hidden="true" />
                        Reveal answer
                      </button>
                    ) : (
                      <div className="animate-slide-up">
                        <div
                          className="rounded-2xl border p-5 mb-4"
                          style={{ background: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.35)" }}
                        >
                          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-green-400/80 mb-1.5">answer</p>
                          <p className="font-syne text-cream text-base leading-snug">{current.correctAnswer}</p>
                        </div>
                        {!lastResult && (
                          <div className="grid grid-cols-2 gap-2.5">
                            <button
                              type="button"
                              disabled={grading}
                              onClick={() => handleSelfGrade(false)}
                              className="rounded-xl border px-4 py-3.5 min-h-[52px] font-bebas text-base tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110 disabled:opacity-60"
                              style={{ background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.4)", color: "#EEF4FF" }}
                            >
                              <XCircle size={16} weight="fill" aria-hidden="true" />
                              Missed it
                            </button>
                            <button
                              type="button"
                              disabled={grading}
                              onClick={() => handleSelfGrade(true)}
                              className="rounded-xl border px-4 py-3.5 min-h-[52px] font-bebas text-base tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110 disabled:opacity-60"
                              style={{ background: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.45)", color: "#EEF4FF" }}
                            >
                              <CheckCircle size={16} weight="fill" aria-hidden="true" />
                              I knew it
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Explanation (MCQ, after answering) */}
                {current.kind === "mcq" && selected !== null && current.explanation && (
                  <div
                    className="mt-4 rounded-xl border p-4 animate-slide-up"
                    style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
                  >
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/50 mb-1.5">why</p>
                    <p className="font-syne text-cream/75 text-sm leading-relaxed italic">{current.explanation}</p>
                  </div>
                )}

                {/* Result banner + Next */}
                {lastResult && (
                  <div className="mt-5 animate-slide-up">
                    {lastResult.mastered ? (
                      <div className="flex items-center gap-2 justify-center mb-4 font-syne text-sm" style={{ color: "#FFD700" }}>
                        <Sparkle size={16} weight="fill" aria-hidden="true" />
                        Mastered. This one is retired from your review deck.
                      </div>
                    ) : lastResult.correct ? (
                      <p className="text-center mb-4 font-syne text-sm text-green-400/90">
                        Nice. You will see this again later, spaced further out.
                      </p>
                    ) : (
                      <p className="text-center mb-4 font-syne text-sm text-red-400/80">
                        No worries. This comes back sooner so it sticks.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleNext}
                      className="w-full font-bebas text-base tracking-wider px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110"
                      style={{ background: `${PURPLE}25`, border: `1px solid ${PURPLE}60`, color: "#EEF4FF" }}
                    >
                      {index + 1 >= items.length ? "Finish review" : "Next"}
                      <ArrowRight size={16} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* DONE — session summary */}
            {phase === "done" && (
              <div className="text-center py-12 animate-slide-up">
                <div
                  className="w-20 h-20 rounded-full inline-flex items-center justify-center mb-5"
                  style={{
                    background: `radial-gradient(circle, ${PURPLE}40 0%, transparent 70%)`,
                    boxShadow: `0 0 40px ${PURPLE}44`,
                    color: PURPLE,
                  }}
                >
                  <Sparkle size={40} weight="fill" aria-hidden="true" color="currentColor" />
                </div>
                <p className="font-bebas text-5xl text-cream tracking-wider mb-1">
                  {correctCount} / {reviewed}
                </p>
                <p className="text-cream/60 text-sm font-syne mb-8">
                  {masteredCount > 0
                    ? `You mastered ${masteredCount} weak spot${masteredCount === 1 ? "" : "s"} this round.`
                    : "Every rep makes the next one easier."}
                </p>

                <div className="flex flex-col sm:flex-row gap-2.5 justify-center max-w-md mx-auto">
                  <button
                    type="button"
                    onClick={load}
                    className="flex-1 font-bebas text-base tracking-wider px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110"
                    style={{ background: `${PURPLE}25`, border: `1px solid ${PURPLE}60`, color: "#EEF4FF" }}
                  >
                    <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
                    Review more
                  </button>
                  <Link
                    href="/learn"
                    className="flex-1 font-bebas text-base tracking-wider px-6 py-3 rounded-xl flex items-center justify-center transition-all active:scale-[0.99] hover:brightness-110"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#EEF4FF" }}
                  >
                    Back to Learn
                  </Link>
                </div>
              </div>
            )}

          </div>
        </div>
      </FeatureGate>
    </ProtectedRoute>
  );
}
