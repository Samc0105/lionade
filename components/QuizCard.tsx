"use client";

import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import CoinAnimation from "./CoinAnimation";
import Confetti from "./Confetti";
import { cdnUrl } from "@/lib/cdn";
import { Check, X as XIcon, Lightbulb } from "@phosphor-icons/react";

interface QuizQuestion {
  id: string;
  subject: string;
  question: string;
  options: string[];
  difficulty: string;
}

interface QuizCardProps {
  question: QuizQuestion;
  questionNumber: number;
  totalQuestions: number;
  timeLimit?: number;
  coinReward: number;
  onSelect: (answerIndex: number, timeLeft: number) => void;
  result: { correctIndex: number; explanation: string | null } | null;
}

export default function QuizCard({
  question,
  questionNumber,
  totalQuestions,
  timeLimit = 20,
  coinReward,
  onSelect,
  result,
}: QuizCardProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [showCoin, setShowCoin] = useState(false);
  const [advanceTimer, setAdvanceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();

  const revealed = result !== null && selected !== null;
  const wasCorrect = revealed && selected === result?.correctIndex;

  useEffect(() => {
    setSelected(null);
    setWaiting(false);
    setTimeLeft(timeLimit);
    setShowCoin(false);
    setAdvanceTimer(null);
  }, [question.id, timeLimit]);

  // Show correct/incorrect animation when result arrives
  useEffect(() => {
    if (result && selected !== null) {
      const isCorrect = selected === result.correctIndex;
      if (isCorrect) setShowCoin(true);
    }
  }, [result, selected]);

  useEffect(() => {
    if (revealed || waiting) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSelect(-1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [revealed, waiting, question.id]);

  // Keyboard shortcuts:
  //   1-4 or A-D    → select that option (when not yet answered)
  //   Enter / Space → advance to next question (when answer revealed)
  // Ignored while typing in an input or if modifiers are held.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      // Advance when answer revealed
      if (revealed && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        handleSkip();
        return;
      }

      // Answer selection 1-4 or A-D (case-insensitive)
      if (revealed || waiting) return;
      const key = e.key.toLowerCase();
      const numberMap: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3 };
      const letterMap: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
      const index = numberMap[key] ?? letterMap[key];
      if (index !== undefined && index < question.options.length) {
        e.preventDefault();
        handleSelect(index);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, waiting, question.id, question.options.length]);

  const handleSelect = (index: number) => {
    if (revealed || waiting) return;
    setSelected(index);
    setWaiting(true);
    onSelect(index, timeLeft);
  };

  const handleSkip = () => {
    if (!revealed) return;
    if (advanceTimer) clearTimeout(advanceTimer);
    // Parent handles advancing via the auto-advance timer
    onSelect(-99, 0); // signal to skip (parent ignores since result already set)
  };

  const timerPercent = (timeLeft / timeLimit) * 100;
  // Gold = safe (normal), orange = caution, electric-red = urgent (< 10s on a
  // 15s baseline → ~33%). Sub-5s tips into deep red for the last-stretch tell.
  const timerColor =
    timeLeft > 10 ? "#FFD700"
    : timeLeft > 5 ? "#E67E22"
    : "#E74C3C";

  const difficultyLabel =
    question.difficulty === "beginner" ? "easy" :
    question.difficulty === "intermediate" ? "medium" :
    question.difficulty === "advanced" ? "hard" : question.difficulty;

  const difficultyColor: Record<string, string> = {
    easy: "text-green-400 border-green-400/50 bg-green-400/10",
    medium: "text-yellow-400 border-yellow-400/50 bg-yellow-400/10",
    hard: "text-red-400 border-red-400/50 bg-red-400/10",
    beginner: "text-green-400 border-green-400/50 bg-green-400/10",
    intermediate: "text-yellow-400 border-yellow-400/50 bg-yellow-400/10",
    advanced: "text-red-400 border-red-400/50 bg-red-400/10",
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <CoinAnimation
        trigger={showCoin}
        amount={coinReward}
        onComplete={() => setShowCoin(false)}
      />

      {/* Progress & Info Bar */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-cream/55">
          Q{questionNumber.toString().padStart(2, "0")} of {totalQuestions.toString().padStart(2, "0")}
        </span>
        <div className="flex items-center gap-3">
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.22em] px-2.5 py-1 rounded-full border
              ${difficultyColor[difficultyLabel] || difficultyColor[question.difficulty] || ""}`}
          >
            {difficultyLabel}
          </span>
          <div className="flex items-center gap-1.5 bg-gold/10 border border-gold/30 rounded-full px-3 py-1" aria-label={`${coinReward} Fangs per correct answer`}>
            <img src={cdnUrl("/F.png")} alt="" aria-hidden="true" className="w-5 h-5 object-contain" />
            <span className="font-bebas text-lg text-gold leading-none">+{coinReward}</span>
          </div>
        </div>
      </div>

      {/* Timer Bar */}
      <div className="w-full h-2 bg-white/10 rounded-full mb-6 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-linear"
          style={{
            width: `${timerPercent}%`,
            background: timerColor,
            boxShadow: `0 0 8px ${timerColor}80`,
          }}
        />
      </div>

      {/* Timer Number — exposed as a timer region; the visible glyph is
          decorative so AT reads a single coherent "N seconds remaining". */}
      <div className="flex justify-center mb-6" role="timer" aria-label={`${timeLeft} seconds remaining`}>
        <div
          className="font-bebas text-5xl leading-none transition-all"
          style={{ color: timerColor, textShadow: `0 0 15px ${timerColor}80` }}
          aria-hidden="true"
        >
          {timeLeft}
        </div>
      </div>

      {/* Question */}
      <div className="card mb-6 relative overflow-hidden">
        <span
          className="absolute inset-x-0 -top-px h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,215,0,0.35), transparent)" }}
          aria-hidden="true"
        />
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-gold/70 text-center mb-3">
          {question.subject}
        </p>
        <p className="font-syne text-lg sm:text-xl font-semibold text-cream leading-snug text-center">
          {question.question}
        </p>
      </div>

      {/* Options */}
      <div className="grid grid-cols-1 gap-3" role="group" aria-label="Answer choices. Press 1 to 4 or A to D to answer.">
        {question.options.map((option, index) => {
          let optionClass =
            "w-full text-left px-5 py-4 rounded-xl border transition-all duration-300 font-semibold text-sm ";

          if (!revealed && !waiting) {
            optionClass +=
              "border-electric/20 bg-navy-50 hover:border-gold/60 hover:bg-gold/[0.06] hover:-translate-y-0.5 hover:shadow-[0_0_18px_rgba(255,215,0,0.18)] cursor-pointer";
          } else if (waiting && !revealed) {
            // Waiting for server response — selected pill takes the gold accent
            // (consistency with the +N Fangs chip and the eventual reward).
            optionClass += index === selected
              ? "border-gold/70 bg-gold/[0.10] text-gold shadow-[0_0_24px_rgba(255,215,0,0.22)]"
              : "border-electric/10 bg-navy-50/50 text-cream/40 cursor-not-allowed";
          } else if (revealed && result) {
            if (index === result.correctIndex) {
              optionClass +=
                "border-green-400 bg-green-400/15 text-green-300 shadow-lg shadow-green-400/20";
            } else if (index === selected && index !== result.correctIndex) {
              optionClass += "border-red-400 bg-red-400/15 text-red-300";
            } else {
              optionClass += "border-electric/10 bg-navy-50/50 text-cream/40 cursor-not-allowed";
            }
          } else {
            optionClass += "border-electric/10 bg-navy-50/50 text-cream/40 cursor-not-allowed";
          }

          const optionLabel = ["A", "B", "C", "D"][index];

          // Animation state per option:
          //   - selected + correct  → scale-pop (green flash via existing classes)
          //   - selected + wrong    → horizontal shake
          //   - others              → no transform animation
          // `whileHover/whileTap` are gated to the pre-answer state.
          const isThisCorrectReveal = revealed && index === result?.correctIndex && index === selected;
          const isThisWrongReveal = revealed && index === selected && index !== result?.correctIndex;

          const animateProps = reducedMotion
            ? undefined
            : isThisCorrectReveal
              ? { scale: [1, 1.04, 1] }
              : isThisWrongReveal
                ? { x: [0, -6, 6, -4, 4, 0] }
                : undefined;

          const transitionProps = isThisCorrectReveal
            ? { duration: 0.25, ease: "easeOut" as const }
            : isThisWrongReveal
              ? { duration: 0.28, ease: "easeOut" as const }
              : undefined;

          const interactiveAnims = !revealed && !waiting && !reducedMotion
            ? { whileHover: { y: -2 }, whileTap: { scale: 0.98 } }
            : {};

          // Spell out the option + its post-answer state for screen readers,
          // since the colour/icon cues are visual-only.
          const stateSuffix = isThisCorrectReveal
            ? ". Correct, your answer"
            : isThisWrongReveal
              ? ". Incorrect, your answer"
              : revealed && index === result?.correctIndex
                ? ". Correct answer"
                : "";
          const ariaLabel = `Option ${optionLabel}: ${option}${stateSuffix}`;

          return (
            <motion.button
              key={index}
              type="button"
              onClick={() => handleSelect(index)}
              disabled={revealed || waiting}
              aria-keyshortcuts={`${index + 1} ${optionLabel}`}
              aria-label={ariaLabel}
              aria-pressed={index === selected}
              className={`${optionClass} quiz-option-enter min-h-[44px]`}
              style={{ animationDelay: `${index * 60}ms` }}
              animate={animateProps}
              transition={transitionProps}
              {...interactiveAnims}
            >
              <div className="flex items-center gap-4">
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-bebas text-lg flex-shrink-0
                    ${!revealed
                      ? index === selected && waiting
                        ? "bg-gold/30 text-gold"
                        : "bg-electric/20 text-electric"
                      : index === result?.correctIndex
                      ? "bg-green-400/30 text-green-300"
                      : index === selected
                      ? "bg-red-400/30 text-red-300"
                      : "bg-white/5 text-cream/30"
                    }`}
                >
                  {revealed && result && index === result.correctIndex ? (
                    <Check size={18} weight="bold" aria-hidden="true" />
                  ) : revealed && index === selected && index !== result?.correctIndex ? (
                    <XIcon size={18} weight="bold" aria-hidden="true" />
                  ) : (
                    optionLabel
                  )}
                </span>
                <span>{option}</span>
              </div>
            </motion.button>
          );
        })}

        {/* Correct-answer confetti burst, anchored fresh per question via key */}
        {wasCorrect && (
          <Confetti
            key={`quiz-correct-${question.id}`}
            trigger={true}
            count={30}
            origin="center"
            palette={["#22C55E", "#FFD700", "#4ADE80"]}
            duration={1200}
          />
        )}
      </div>

      {/* Explanation + Next */}
      {revealed && result?.explanation && (
        <div className="mt-4 p-4 rounded-xl border border-electric/20 bg-electric/5 animate-slide-up" role="status" aria-live="polite">
          <div className="flex items-start gap-2.5">
            <span className="text-lg flex-shrink-0 inline-flex items-center justify-center">
              <Lightbulb size={20} weight="regular" color="#4A90D9" aria-hidden="true" />
            </span>
            <p className="text-cream/70 text-sm leading-relaxed">{result.explanation}</p>
          </div>
        </div>
      )}

      {revealed && (
        <button
          type="button"
          onClick={handleSkip}
          aria-keyshortcuts="Enter Space"
          className="quiz-next-pill mt-4 w-full py-3.5 rounded-full font-bebas tracking-[0.18em] text-base text-navy cursor-pointer transition-[transform,filter] duration-200 hover:scale-[1.01] hover:brightness-105 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
          style={{
            background: "linear-gradient(135deg, #FFD700 0%, #EAB308 100%)",
            boxShadow: "0 0 24px rgba(255,215,0,0.22), 0 4px 14px rgba(0,0,0,0.25)",
          }}
        >
          NEXT QUESTION
        </button>
      )}
    </div>
  );
}
