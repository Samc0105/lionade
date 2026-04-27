"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import {
  Lightning, ArrowRight, X, CheckCircle, XCircle, Sparkle, Coin,
  Brain, Trophy, ShareNetwork,
} from "@phosphor-icons/react";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { mutateUserStats } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import Confetti from "@/components/Confetti";
import ShareCard from "@/components/ShareCard";

/**
 * Daily Drill — 5 questions you got wrong before, drilled in 3 minutes.
 *
 * Card placement: dashboard, just below the streak/missions row. Always
 * visible while there's a drill available; flips to a "claimed today"
 * state once completed. Hidden if the user has zero historical wrong
 * answers (new accounts).
 *
 * Reward: 5F per correct + 20F bonus on a clean sweep.
 */

interface DrillQuestion {
  id: string;
  question: string;
  options: [string, string, string, string];
  difficulty: "easy" | "medium" | "hard";
  subtopicName: string | null;
  className: string | null;
  examTitle: string | null;
  lastWrongAt: string;
}

interface DrillResponse {
  completed: boolean;
  empty?: boolean;
  questions: DrillQuestion[];
  // present when completed=true
  score?: number;
  total?: number;
  coinsEarned?: number;
  completedAt?: string;
}

export default function DailyDrillWidget() {
  const { user } = useAuth();
  const { data, mutate } = useSWR<DrillResponse>(
    user?.id ? "/api/daily-drill" : null,
    swrFetcher,
    { revalidateOnFocus: true },
  );
  const [drillOpen, setDrillOpen] = useState(false);

  if (!user?.id) return null;
  if (!data) return null;
  if (data.empty) return null;            // nothing to drill yet
  if (!data.questions.length && !data.completed) return null;

  const completed = data.completed;
  const total = data.total ?? data.questions.length ?? 0;
  const score = data.score ?? 0;

  return (
    <>
      <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.06s" }}>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-bebas text-xl text-cream tracking-wider inline-flex items-center gap-2">
            <Lightning size={16} weight="fill" className="text-electric" /> DAILY DRILL
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40">
            {completed ? "Today: complete" : "5 questions · 3 min"}
          </span>
        </div>

        <button
          type="button"
          onClick={() => !completed && data.questions.length > 0 && setDrillOpen(true)}
          disabled={completed}
          className={`
            w-full text-left rounded-[12px] border px-5 py-4 transition-all duration-200
            ${completed
              ? "border-[#22C55E]/30 bg-[#22C55E]/[0.06] cursor-default"
              : "border-electric/30 bg-gradient-to-r from-electric/[0.07] to-transparent hover:border-electric/60 hover:bg-electric/[0.1] active:scale-[0.99]"
            }
          `}
        >
          <div className="flex items-center gap-4">
            <div
              className={`
                shrink-0 grid place-items-center w-12 h-12 rounded-full
                ${completed
                  ? "bg-[#22C55E]/[0.15] text-[#22C55E]"
                  : "bg-electric/[0.18] text-electric"}
              `}
            >
              {completed
                ? <CheckCircle size={20} weight="fill" />
                : <Brain size={18} weight="fill" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-syne font-semibold text-[15px] text-cream leading-tight mb-0.5">
                {completed
                  ? `You scored ${score}/${total} today`
                  : "Drill 5 questions you missed before"}
              </p>
              <p className="text-[12.5px] text-cream/55 leading-snug">
                {completed
                  ? `+${data.coinsEarned ?? 0} Fangs · come back tomorrow for a fresh drill`
                  : "Quick spaced-repetition review — keep your streak fed"}
              </p>
            </div>
            {!completed && (
              <ArrowRight size={16} weight="bold" className="text-electric shrink-0" />
            )}
            {completed && score === total && total >= 3 && (
              <Trophy size={16} weight="fill" className="text-gold shrink-0" />
            )}
          </div>
        </button>
      </div>

      {drillOpen && data.questions.length > 0 && (
        <DrillModal
          questions={data.questions}
          onClose={(refreshed) => {
            setDrillOpen(false);
            if (refreshed) {
              void mutate();
              if (user.id) mutateUserStats(user.id);
            }
          }}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drill modal — renders one question at a time with quick option buttons.
// Posts results to /complete on the last question.
// ─────────────────────────────────────────────────────────────────────────────
function DrillModal({
  questions, onClose,
}: {
  questions: DrillQuestion[];
  onClose: (refreshed: boolean) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Array<{ questionId: string; selectedIndex: number; wasCorrect: boolean }>>([]);
  const [done, setDone] = useState<{ score: number; total: number; coinsEarned: number; perfect: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; correctIndex: number } | null>(null);
  const reducedMotion = useReducedMotion();

  const q = questions[idx];

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const submitFinal = async (allAnswers: typeof answers) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      type R = { score: number; total: number; coinsEarned: number; alreadyCompleted: boolean; perfect?: boolean };
      const r = await apiPost<R>("/api/daily-drill/complete", {
        results: allAnswers.map(a => ({ questionId: a.questionId, wasCorrect: a.wasCorrect })),
      });
      if (r.ok && r.data) {
        setDone({
          score: r.data.score,
          total: r.data.total,
          coinsEarned: r.data.coinsEarned,
          perfect: !!r.data.perfect,
        });
      } else {
        // Fallback: still show local results.
        const localScore = allAnswers.filter(a => a.wasCorrect).length;
        setDone({ score: localScore, total: allAnswers.length, coinsEarned: 0, perfect: localScore === allAnswers.length });
      }
    } catch {
      const localScore = allAnswers.filter(a => a.wasCorrect).length;
      setDone({ score: localScore, total: allAnswers.length, coinsEarned: 0, perfect: localScore === allAnswers.length });
    } finally {
      setSubmitting(false);
    }
  };

  const onPick = (i: number) => {
    if (picked !== null || !q) return;
    setPicked(i);
    // Daily Drill is low-stakes — we trust the question payload's
    // visible structure for "correct" feedback. Server will re-validate
    // on POST anyway. We don't have correct_index in the client payload
    // (we deliberately don't ship it), so we'll send wasCorrect based on
    // server-side validation in /complete. For UI feedback during the
    // drill, we just show "selected" and move on after a brief pause.
    //
    // To keep snappy + still reward: we submit ALL picks at the end and
    // trust the server's count. Local UI shows "you picked X" without
    // claiming right/wrong mid-drill.
    setFeedback({ correct: false, correctIndex: -1 }); // placeholder — see render
    setTimeout(() => {
      const recordedCorrect = false; // placeholder; corrected by server
      const next = [...answers, { questionId: q.id, selectedIndex: i, wasCorrect: recordedCorrect }];
      setAnswers(next);

      if (idx + 1 >= questions.length) {
        // Final question — submit with the SELECTED indices and let the
        // server compute correctness. We pass selectedIndex as a hint;
        // /complete will look up correct_index server-side.
        void submitFinalSelected(next);
      } else {
        setIdx(i2 => i2 + 1);
        setPicked(null);
        setFeedback(null);
      }
    }, 350);
  };

  // Submit using selectedIndex; the API /complete currently expects
  // wasCorrect from client. To make this server-authoritative we need a
  // tiny tweak: send selectedIndex and let server compute. For now, send
  // wasCorrect=true for every answer and let the server re-check — but
  // since /complete's current code uses wasCorrect from the payload, we
  // need to change /complete to look up correct_index instead.
  const submitFinalSelected = async (allPicks: typeof answers) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Send selectedIndex to server so it can compute correctness.
      type R = { score: number; total: number; coinsEarned: number; alreadyCompleted: boolean; perfect?: boolean };
      const r = await apiPost<R>("/api/daily-drill/complete", {
        results: allPicks.map(a => ({ questionId: a.questionId, selectedIndex: a.selectedIndex })),
      });
      if (r.ok && r.data) {
        setDone({
          score: r.data.score,
          total: r.data.total,
          coinsEarned: r.data.coinsEarned,
          perfect: !!r.data.perfect,
        });
      }
    } catch (e) {
      console.error("[DailyDrill submit]", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-xl rounded-[14px] border border-electric/30 bg-gradient-to-br from-navy to-[#0a0f1d] p-5 sm:p-6 shadow-2xl animate-slide-up">
        <button
          type="button"
          onClick={() => onClose(false)}
          aria-label="Close"
          className="absolute top-3 right-3 grid place-items-center w-7 h-7 rounded-full text-cream/40 hover:text-cream hover:bg-white/[0.05]"
        >
          <X size={14} weight="bold" />
        </button>

        {!done && q && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Lightning size={14} className="text-electric" weight="fill" />
              <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-electric">
                Daily Drill · {idx + 1} / {questions.length}
              </span>
            </div>

            {/* Progress bar */}
            <div className="flex gap-1 mb-5">
              {questions.map((_, i) => (
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

            {/* Subtopic / class context */}
            {(q.subtopicName || q.className) && (
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/40 mb-2">
                {[q.className, q.subtopicName].filter(Boolean).join(" · ")} · missed previously
              </p>
            )}

            <p className="text-[15px] text-cream leading-relaxed mb-4">
              {q.question}
            </p>

            <div className="flex flex-col gap-2">
              {q.options.map((opt, i) => {
                const isPicked = picked === i;
                // Drill correctness is server-authoritative and intentionally
                // hidden mid-drill (see onPick comment), so we can't show
                // green/red. Instead we give the picked card a subtle
                // selection pop so the click feels acknowledged before the
                // 350ms advance fires.
                const animateProps = reducedMotion
                  ? undefined
                  : isPicked
                    ? { scale: [1, 1.04, 1] }
                    : undefined;
                const transitionProps = isPicked
                  ? { duration: 0.25, ease: "easeOut" as const }
                  : undefined;
                const interactiveAnims = picked === null && !reducedMotion
                  ? { whileHover: { y: -2 }, whileTap: { scale: 0.98 } }
                  : {};
                return (
                  <motion.button
                    key={i}
                    type="button"
                    onClick={() => onPick(i)}
                    disabled={picked !== null}
                    className={`
                      group flex items-start gap-3 text-left rounded-[8px] px-4 py-3 border transition-colors duration-150
                      ${isPicked
                        ? "border-electric/60 bg-electric/[0.08] text-cream"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.2] hover:bg-white/[0.05] text-cream/90"}
                      disabled:cursor-not-allowed
                    `}
                    animate={animateProps}
                    transition={transitionProps}
                    {...interactiveAnims}
                  >
                    <span className={`font-mono text-[10px] uppercase tracking-wider mt-0.5 shrink-0 ${isPicked ? "text-electric" : "text-cream/40"}`}>
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="flex-1 text-[13.5px] leading-relaxed">{opt}</span>
                  </motion.button>
                );
              })}
            </div>
          </>
        )}

        {done && (
          <DrillResults
            score={done.score}
            total={done.total}
            coinsEarned={done.coinsEarned}
            perfect={done.perfect}
            onClose={() => onClose(true)}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function DrillResults({
  score, total, coinsEarned, perfect, onClose,
}: {
  score: number;
  total: number;
  coinsEarned: number;
  perfect: boolean;
  onClose: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="text-center py-3 animate-slide-up">
      <Confetti
        trigger={perfect}
        count={60}
        origin="center"
        palette={["#FFD700", "#F0B429", "#4A90D9", "#22C55E"]}
        duration={1600}
      />
      <div className="flex justify-center mb-3">
        {perfect
          ? <Trophy size={42} weight="fill" className="text-gold" />
          : score >= total / 2
            ? <Sparkle size={42} weight="fill" className="text-electric" />
            : <Brain size={42} weight="fill" className="text-cream/50" />
        }
      </div>
      <h3 className="font-bebas text-[36px] tracking-wider text-cream leading-none mb-1">
        {perfect ? "PERFECT" : score >= total / 2 ? "NICE" : "GOOD START"}
      </h3>
      <p className="text-cream/50 text-[14px] mb-1">
        You got <span className="text-cream font-bold">{score}</span> of {total}
      </p>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-gold/[0.1] border border-gold/30 px-3 py-1 mb-5">
        <Coin size={12} weight="fill" className="text-gold" />
        <span className="font-bebas text-[18px] tabular-nums text-gold tracking-wider leading-none">
          +{coinsEarned}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-gold/70">Fangs</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="rounded-full border border-gold/40 text-gold hover:bg-gold/10
            font-mono text-[11px] uppercase tracking-[0.25em] py-3 transition-colors
            inline-flex items-center justify-center gap-1.5"
        >
          <ShareNetwork size={11} weight="fill" /> Share
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-electric text-white hover:bg-electric/90
            font-mono text-[11px] uppercase tracking-[0.25em] py-3 transition-colors"
        >
          Done
        </button>
      </div>
      {!perfect && (
        <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-cream/30 mt-3">
          Come back tomorrow for a fresh drill
        </p>
      )}

      <ShareCard
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shareTitle={perfect ? "daily-drill-perfect" : "daily-drill"}
        card={{
          headline: "DAILY DRILL",
          subline: perfect ? "Perfect run" : `Drilled ${score}/${total}`,
          bigNumber: { value: `+${coinsEarned}`, label: "Fangs earned" },
          stats: [
            { label: "Score", value: `${score}/${total}` },
            { label: perfect ? "Status" : "Result", value: perfect ? "Flawless" : `${Math.round((score / total) * 100)}%` },
          ],
          accent: perfect ? "#FFD700" : "#4A90D9",
        }}
      />
    </div>
  );
}
