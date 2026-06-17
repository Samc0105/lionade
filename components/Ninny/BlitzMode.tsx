"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useReducedMotion } from "framer-motion";
import { cdnUrl } from "@/lib/cdn";
import { weightedShuffle, type MCQQuestion } from "@/lib/ninny";
import type { NinnyWrongAnswer } from "./MultipleChoiceMode";
import { Fire } from "@phosphor-icons/react";

interface Props {
  questions: MCQQuestion[];
  wrongAnswerCounts?: Map<string, number>;
  /** Plays used today (passed in so the in-game HUD can show "3/99"). */
  playsToday?: number;
  /** Daily cap (passed in alongside playsToday). */
  playsLimit?: number;
  onComplete: (result: {
    score: number;
    total: number;
    wrongAnswers: NinnyWrongAnswer[];
    longestStreak: number;
  }) => void;
}

const BLITZ_DURATION_SEC = 60;
const NINNY_PURPLE = "#A855F7";
const RECENT_WINDOW = 5;

export default function BlitzMode({ questions, wrongAnswerCounts, playsToday, playsLimit, onComplete }: Props) {
  const reduceMotion = useReducedMotion();
  // Spaced-repetition shuffle, looped infinitely (deck can repeat in 60s)
  const deck = useMemo(() => {
    if (wrongAnswerCounts && wrongAnswerCounts.size > 0) {
      return weightedShuffle(questions, (q) => q.question, wrongAnswerCounts, questions.length);
    }
    return [...questions].sort(() => Math.random() - 0.5);
  }, [questions, wrongAnswerCounts]);
  const [pos, setPos] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(BLITZ_DURATION_SEC);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState<NinnyWrongAnswer[]>([]);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  // Rolling window of the last RECENT_WINDOW answers, true = correct.
  // Renders below the options to give a quick "how's the run going" cue.
  const [recent, setRecent] = useState<boolean[]>([]);
  const completedRef = useRef(false);
  const finalCountRef = useRef(0); // total questions actually shown
  const longestStreakRef = useRef(0); // peak streak across the run

  const current = deck[pos % deck.length];

  // Countdown
  useEffect(() => {
    if (completedRef.current) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          if (!completedRef.current) {
            completedRef.current = true;
            // Defer onComplete to avoid setState-in-render
            setTimeout(() => {
              onComplete({
                score,
                total: Math.max(1, finalCountRef.current),
                wrongAnswers,
                longestStreak: longestStreakRef.current,
              });
            }, 0);
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnswer = useCallback(
    (selectedIdx: number) => {
      if (completedRef.current || feedback !== null || !current) return;
      finalCountRef.current += 1;
      const isCorrect = selectedIdx === current.correctIndex;
      if (isCorrect) {
        setScore((s) => s + 1);
        setStreak((s) => {
          const next = s + 1;
          if (next > longestStreakRef.current) longestStreakRef.current = next;
          return next;
        });
        setFeedback("correct");
      } else {
        setStreak(0);
        setFeedback("wrong");
        setWrongAnswers((w) => [
          ...w,
          {
            question: current.question,
            correctAnswer: current.options[current.correctIndex],
            userAnswer: current.options[selectedIdx],
            explanation: current.explanation,
          },
        ]);
      }
      setRecent((r) => {
        const next = [...r, isCorrect];
        return next.length > RECENT_WINDOW ? next.slice(-RECENT_WINDOW) : next;
      });
      // Brief flash, then advance
      setTimeout(() => {
        setFeedback(null);
        setPos((p) => p + 1);
      }, 350);
    },
    [feedback, current],
  );

  if (!current) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-10 text-center">
        <p className="font-bebas text-lg text-cream/70 tracking-wider mb-1">BLITZ NEEDS QUESTIONS</p>
        <p className="text-cream/45 text-xs">Add a few terms to this set and Blitz lights up.</p>
      </div>
    );
  }

  // Time-based color
  const timeColor =
    secondsLeft <= 10 ? "#EF4444" : secondsLeft <= 20 ? "#FBBF24" : "#FFD700";
  const timePct = (secondsLeft / BLITZ_DURATION_SEC) * 100;

  // Coarse, threshold-only announcement for screen readers. Announcing every
  // second would flood the SR queue, so we only speak at meaningful marks.
  const timeAnnouncement = useMemo(() => {
    if (secondsLeft === 30) return "30 seconds remaining";
    if (secondsLeft === 10) return "10 seconds remaining";
    if (secondsLeft === 5) return "5 seconds remaining";
    return "";
  }, [secondsLeft]);

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-up">
      {/* HUD: timer, score, streak */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {/* Timer */}
        <div
          className="rounded-xl border bg-white/5 backdrop-blur px-3 py-2 text-center"
          style={{
            borderColor: secondsLeft <= 10 ? "rgba(239,68,68,0.4)" : "rgba(255,215,0,0.3)",
          }}
        >
          <p className="font-bebas text-[9px] tracking-widest uppercase text-cream/40">
            Time
          </p>
          <p
            className="font-bebas text-2xl tracking-wider"
            role="timer"
            aria-live="off"
            aria-label={`${secondsLeft} seconds remaining`}
            style={{
              color: timeColor,
              animation:
                secondsLeft <= 10 && !reduceMotion
                  ? "pulse 1s ease-in-out infinite"
                  : undefined,
            }}
          >
            {secondsLeft}s
          </p>
          <span className="sr-only" role="status" aria-live="assertive">
            {timeAnnouncement}
          </span>
        </div>

        {/* Score */}
        <div
          className="rounded-xl border bg-white/5 backdrop-blur px-3 py-2 text-center"
          style={{ borderColor: "rgba(255,215,0,0.3)" }}
        >
          <p className="font-bebas text-[9px] tracking-widest uppercase text-cream/40">
            Score
          </p>
          <div className="flex items-center justify-center gap-1.5">
            <img src={cdnUrl("/F.png")} alt="" className="w-4 h-4 object-contain" />
            <p className="font-bebas text-2xl tracking-wider text-gold">{score}</p>
          </div>
        </div>

        {/* Streak */}
        <div
          className="rounded-xl border bg-white/5 backdrop-blur px-3 py-2 text-center"
          style={{
            borderColor: streak >= 3 ? `${NINNY_PURPLE}50` : "rgba(255,255,255,0.10)",
          }}
        >
          <p className="font-bebas text-[9px] tracking-widest uppercase text-cream/40">
            Streak
          </p>
          <p
            className="font-bebas text-2xl tracking-wider inline-flex items-center justify-center gap-1"
            style={{ color: streak >= 3 ? NINNY_PURPLE : "rgba(238,244,255,0.50)" }}
          >
            {streak >= 3 && (
              <Fire size={14} weight="fill" aria-hidden="true" className="inline -mt-0.5" />
            )}{" "}
            {streak}
          </p>
        </div>
      </div>

      {/* Time bar */}
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-6">
        <div
          className="h-full transition-all duration-1000 linear"
          style={{
            width: `${timePct}%`,
            background:
              secondsLeft <= 10
                ? "linear-gradient(90deg, #EF4444 0%, #F87171 100%)"
                : "linear-gradient(90deg, #FFD700 0%, #F0C000 100%)",
            boxShadow: secondsLeft <= 10 ? "0 0 16px rgba(239,68,68,0.5)" : undefined,
          }}
        />
      </div>

      {/* Question card with feedback flash */}
      <div
        className="rounded-2xl border-2 backdrop-blur p-5 mb-4 transition-colors duration-200"
        style={{
          background: "rgba(255,255,255,0.04)",
          borderColor:
            feedback === "correct"
              ? "rgba(34,197,94,0.55)"
              : feedback === "wrong"
              ? "rgba(239,68,68,0.55)"
              : `${NINNY_PURPLE}25`,
        }}
      >
        <p className="font-bebas text-cream text-xl tracking-wide leading-snug">
          {current.question}
        </p>
      </div>

      {/* Options grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {current.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleAnswer(i)}
            disabled={feedback !== null}
            className="text-left px-4 py-3 rounded-xl border font-syne text-sm
              bg-white/5 hover:bg-white/10 hover:border-gold/40 motion-safe:active:scale-[0.98]
              transition-all duration-150 text-cream disabled:cursor-not-allowed"
            style={{ borderColor: "rgba(255,255,255,0.10)" }}
          >
            <span className="font-bebas text-gold mr-2 tracking-wider">
              {String.fromCharCode(65 + i)}
            </span>
            {opt}
          </button>
        ))}
      </div>

      {/* Run footer: recent-5 strip + plays-today */}
      <div className="mt-5 flex items-center justify-between gap-4 px-1">
        <div className="flex items-center gap-2">
          <p className="font-bebas text-[10px] tracking-widest uppercase text-cream/30">
            Recent
          </p>
          <div className="flex items-center gap-1.5" aria-label="Last five answers">
            {Array.from({ length: RECENT_WINDOW }).map((_, i) => {
              const slot = recent[recent.length - RECENT_WINDOW + i];
              const filled = slot !== undefined;
              const color = !filled
                ? "rgba(255,255,255,0.10)"
                : slot
                ? "#FFD700"
                : "#EF4444";
              return (
                <span
                  key={i}
                  className="block w-2 h-2 rounded-full"
                  style={{
                    background: color,
                    boxShadow: filled && slot ? "0 0 6px rgba(255,215,0,0.45)" : undefined,
                  }}
                  aria-hidden="true"
                />
              );
            })}
          </div>
        </div>

        {playsToday !== undefined && playsLimit !== undefined && (
          <p className="font-bebas text-[10px] tracking-widest uppercase text-cream/30">
            Plays today <span className="text-cream/60 ml-1">{playsToday + 1}/{playsLimit}</span>
          </p>
        )}
      </div>
    </div>
  );
}
