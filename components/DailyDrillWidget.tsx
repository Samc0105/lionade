"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import {
  Lightning, ArrowRight, X, CheckCircle, XCircle, Sparkle, Coin,
  Brain, Trophy, ShareNetwork,
} from "@phosphor-icons/react";
import ClaimBanner from "@/components/ClaimBanner";
import { apiGet, apiPost, swrFetcher } from "@/lib/api-client";
import { mutateUserStats } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useHeartbeat } from "@/lib/use-heartbeat";
import dynamic from "next/dynamic";
const Confetti = dynamic(() => import("@/components/Confetti"), { ssr: false });
const ShareCard = dynamic(() => import("@/components/ShareCard"), { ssr: false });

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
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/60">
            {completed ? "Today: complete" : "5 questions · 3 min"}
          </span>
        </div>

        {completed ? (
          <div className="w-full rounded-[12px] border border-[#22C55E]/30 bg-[#22C55E]/[0.06] px-5 py-4">
            <div className="flex items-center gap-4">
              <div className="shrink-0 grid place-items-center w-12 h-12 rounded-full bg-[#22C55E]/[0.15] text-[#22C55E]">
                <CheckCircle size={20} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-syne font-semibold text-[15px] text-cream leading-tight mb-0.5">
                  {`You scored ${score}/${total} today`}
                </p>
                <p className="text-[12.5px] text-cream/55 leading-snug">
                  {`+${data.coinsEarned ?? 0} Fangs · come back tomorrow for a fresh drill`}
                </p>
              </div>
              {score === total && total >= 3 && (
                <Trophy size={16} weight="fill" className="text-gold shrink-0" />
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => data.questions.length > 0 && setDrillOpen(true)}
            className="block w-full text-left rounded-[14px] transition-transform duration-200 active:scale-[0.99]"
          >
            <ClaimBanner
              variant="electric"
              size="panel"
              ariaLabel="Daily Drill ready — 5 questions you missed"
              icon={<Brain size={18} weight="fill" />}
              title="Drill 5 questions you missed before"
              description="Quick spaced-repetition review — keep your streak fed"
              meta={<>5Q &middot; 3 MIN</>}
            >
              <span className="sr-only">Open the daily drill</span>
            </ClaimBanner>
          </button>
        )}
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
  // Tier 3 — fast-forward past any questions the user already answered
  // earlier today (server-persisted via /api/daily-drill/state). The
  // passed-in `questions` array is the FULL 5; we drop ones that match a
  // saved answered_question_id. Result is the "remaining" subset. We seed
  // the running answers array with zero-fill placeholders so the final
  // submit still passes selectedIndex for the answered ones — actually the
  // /complete route only scores selectedIndex for the questions in its
  // results payload, so we just submit the ones answered in THIS sitting.
  // The server already credits the prior correct_count via the progress row
  // (V2). For V1 we accept that a true mid-drill resume submits only the
  // remaining; daily-drill /complete is idempotent per day, so the user
  // will see "you scored X of N" with N = remaining-this-session. Good
  // enough for V1; a tighter rollup ships when /complete reads
  // daily_drill_progress (backend follow-up).
  const today = new Date().toISOString().slice(0, 10);
  const [resumeFilter, setResumeFilter] = useState<string[]>([]);  // answered earlier today
  const [resumeChecked, setResumeChecked] = useState(false);
  const filteredQuestions = resumeChecked
    ? questions.filter(q => !resumeFilter.includes(q.id))
    : questions;

  // Heartbeat — pings /api/presence/heartbeat so the AFK reaper doesn't
  // clear the active_session pin pointing at today's drill while the user
  // is mid-modal. Only fires while the modal is mounted.
  useHeartbeat("daily_drill", today);

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Array<{ questionId: string; selectedIndex: number; wasCorrect: boolean }>>([]);
  const [done, setDone] = useState<{ score: number; total: number; coinsEarned: number; perfect: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; correctIndex: number } | null>(null);
  const reducedMotion = useReducedMotion();

  const q = filteredQuestions[idx];

  // ── A11y (WCAG 2.1.2 / 2.4.3) — focus management for the modal dialog.
  // dialogRef scopes the focus trap; triggerRef remembers what had focus when
  // the modal opened so we can restore it on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Remember the trigger, move focus into the dialog on open, and restore
  // focus to the trigger on close.
  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    // Prefer the first interactive control that isn't the close button so the
    // drill itself receives focus; fall back to the close button.
    const first = focusables && focusables.length > 1 ? focusables[1] : focusables?.[0];
    first?.focus();
    return () => {
      triggerRef.current?.focus?.();
    };
  }, []);

  // Trap Tab within the dialog and wire Escape to close.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const list = Array.from(focusables);
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === firstEl || !dialogRef.current?.contains(active)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (active === lastEl || !dialogRef.current?.contains(active)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // On open, pull today's progress row (if any) so we know which questions
  // the user already answered and can skip past them. One-shot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      type StateResp = {
        state: { answeredQuestionIds: string[]; correctCount: number } | null;
      };
      const r = await apiGet<StateResp>("/api/daily-drill/state");
      if (cancelled) return;
      if (r.ok && r.data?.state?.answeredQuestionIds?.length) {
        setResumeFilter(r.data.state.answeredQuestionIds);
      }
      setResumeChecked(true);
    })();
    return () => { cancelled = true; };
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
    // Autosave this answer to /api/daily-drill/state so a refresh resumes
    // from the next question. wasCorrect is unknown client-side (correct
    // answer comes back only from /complete), so we record wasCorrect=false
    // here and accept the running correct_count is a floor — /complete
    // returns the canonical score. Fire-and-forget.
    void apiPost("/api/daily-drill/state", { questionId: q.id, wasCorrect: false });
    setTimeout(() => {
      const recordedCorrect = false; // placeholder; corrected by server
      const next = [...answers, { questionId: q.id, selectedIndex: i, wasCorrect: recordedCorrect }];
      setAnswers(next);

      if (idx + 1 >= filteredQuestions.length) {
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
      ref={dialogRef}
      className="fluid-modal-backdrop fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Daily Drill"
    >
      <div className="relative w-full max-w-xl rounded-[14px] border border-electric/30 bg-gradient-to-br from-navy to-[#0a0f1d] p-5 sm:p-6 shadow-2xl animate-slide-up">
        <button
          type="button"
          onClick={() => onClose(false)}
          aria-label="Close"
          className="absolute top-3 right-3 grid place-items-center w-7 h-7 rounded-full text-cream/60 hover:text-cream hover:bg-white/[0.05]"
        >
          <X size={14} weight="bold" />
        </button>

        {!done && q && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Lightning size={14} className="text-electric" weight="fill" />
              <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-electric">
                Daily Drill · {idx + 1} / {filteredQuestions.length}
              </span>
            </div>

            {/* Progress bar */}
            <div className="flex gap-1 mb-5">
              {filteredQuestions.map((_, i) => (
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
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/60 mb-2">
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
                    <span className={`font-mono text-[10px] uppercase tracking-wider mt-0.5 shrink-0 ${isPicked ? "text-electric" : "text-cream/60"}`}>
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
        <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-cream/55 mt-3">
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
