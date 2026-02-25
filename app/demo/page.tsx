"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ── Hardcoded demo questions ─────────────────────────────────

interface DemoQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  subject: string;
}

const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    question: "What is the powerhouse of the cell?",
    options: ["Nucleus", "Ribosome", "Mitochondria", "Golgi apparatus"],
    correctAnswer: 2,
    subject: "Science",
  },
  {
    question: "What does CPU stand for?",
    options: [
      "Central Processing Unit",
      "Computer Personal Unit",
      "Central Program Utility",
      "Core Processing Unit",
    ],
    correctAnswer: 0,
    subject: "Tech",
  },
  {
    question: "Which planet is known as the Red Planet?",
    options: ["Venus", "Jupiter", "Mars", "Saturn"],
    correctAnswer: 2,
    subject: "Science",
  },
  {
    question: "What is the value of pi (π) rounded to two decimal places?",
    options: ["3.12", "3.14", "3.16", "3.18"],
    correctAnswer: 1,
    subject: "Math",
  },
  {
    question: "Who painted the Mona Lisa?",
    options: [
      "Vincent van Gogh",
      "Pablo Picasso",
      "Leonardo da Vinci",
      "Michelangelo",
    ],
    correctAnswer: 2,
    subject: "General",
  },
];

const TIMER_SECONDS = 15;

type Phase = "intro" | "quiz" | "results";

export default function DemoPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [currentQ, setCurrentQ] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const [selected, setSelected] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [showCorrect, setShowCorrect] = useState(false);

  const question = DEMO_QUESTIONS[currentQ];
  const totalQuestions = DEMO_QUESTIONS.length;

  // ── Advance to next question or results ────────────────────
  const advance = useCallback(() => {
    setAnswers((prev) => {
      const next = [...prev];
      if (next.length <= currentQ) next.push(selected);
      return next;
    });

    if (currentQ + 1 < totalQuestions) {
      setCurrentQ((q) => q + 1);
      setSelected(null);
      setLocked(false);
      setShowCorrect(false);
      setTimeLeft(TIMER_SECONDS);
    } else {
      setPhase("results");
    }
  }, [currentQ, selected, totalQuestions]);

  // ── Timer countdown ────────────────────────────────────────
  useEffect(() => {
    if (phase !== "quiz" || locked) return;

    if (timeLeft <= 0) {
      // Time's up — lock and show correct, then advance
      setLocked(true);
      setShowCorrect(true);
      const t = setTimeout(advance, 1200);
      return () => clearTimeout(t);
    }

    const interval = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [phase, timeLeft, locked, advance]);

  // ── Handle answer selection ────────────────────────────────
  const handleSelect = (idx: number) => {
    if (locked) return;
    setSelected(idx);
    setLocked(true);
    setShowCorrect(true);

    // Auto-advance after a brief reveal
    setTimeout(advance, 1200);
  };

  // ── Calculate results ──────────────────────────────────────
  const score = answers.filter(
    (a, i) => a === DEMO_QUESTIONS[i].correctAnswer
  ).length;

  const restart = () => {
    setPhase("intro");
    setCurrentQ(0);
    setTimeLeft(TIMER_SECONDS);
    setSelected(null);
    setLocked(false);
    setAnswers([]);
    setShowCorrect(false);
  };

  // ── Timer color ────────────────────────────────────────────
  const timerColor =
    timeLeft <= 3
      ? "text-red-400"
      : timeLeft <= 7
        ? "text-yellow-400"
        : "text-green-400";

  const timerBarPercent = (timeLeft / TIMER_SECONDS) * 100;

  // ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4 relative overflow-hidden py-8">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(74,144,217,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.08) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        className="absolute top-1/4 left-1/3 w-80 h-80 rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{
          background: "radial-gradient(circle, #4A90D9 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute bottom-1/4 right-1/3 w-64 h-64 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{
          background: "radial-gradient(circle, #F0B429 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-lg animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-3 group"
          >
            <div className="w-10 h-10 rounded-xl bg-electric flex items-center justify-center shadow-lg shadow-electric/40">
              <span className="text-white font-bebas text-xl leading-none">
                L
              </span>
            </div>
            <span className="font-bebas text-3xl tracking-wider text-cream group-hover:text-electric transition-colors">
              LIONADE
            </span>
          </Link>
        </div>

        {/* ── INTRO SCREEN ── */}
        {phase === "intro" && (
          <div
            className="rounded-2xl border border-electric/20 p-8 text-center animate-slide-up"
            style={{
              background:
                "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
            }}
          >
            <div className="text-6xl mb-4">🧠</div>
            <h1 className="font-bebas text-4xl text-cream tracking-wider mb-3">
              Sample Quiz
            </h1>
            <p className="text-cream/50 text-sm leading-relaxed mb-2">
              5 general knowledge questions. 15 seconds each.
            </p>
            <p className="text-cream/30 text-xs mb-8">
              No account required — just tap and play.
            </p>

            <div className="space-y-3 text-left mb-8">
              {[
                { icon: "⏱", text: "15-second timer per question" },
                { icon: "🎯", text: "Multiple choice — pick your best answer" },
                { icon: "📊", text: "See your score at the end" },
              ].map((item) => (
                <div
                  key={item.text}
                  className="flex items-center gap-3 text-cream/60 text-sm"
                >
                  <span className="text-lg w-6 text-center flex-shrink-0">
                    {item.icon}
                  </span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                setPhase("quiz");
                setTimeLeft(TIMER_SECONDS);
              }}
              className="w-full py-4 rounded-xl font-bold text-base transition-all duration-200 active:scale-[0.98]"
              style={{
                background:
                  "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                color: "#04080F",
                boxShadow: "0 4px 20px rgba(240,180,41,0.35)",
              }}
            >
              Start Quiz
            </button>

            <Link
              href="/login"
              className="block text-cream/30 text-xs mt-5 hover:text-electric transition-colors"
            >
              Already have an account? Log in
            </Link>
          </div>
        )}

        {/* ── QUIZ SCREEN ── */}
        {phase === "quiz" && (
          <div
            className="rounded-2xl border border-electric/20 overflow-hidden animate-slide-up"
            style={{
              background:
                "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
            }}
          >
            {/* Header: progress + timer */}
            <div className="px-6 pt-5 pb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-cream/40 text-xs font-bold uppercase tracking-widest">
                  Question {currentQ + 1}{" "}
                  <span className="text-cream/20">/ {totalQuestions}</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-lg">⏱</span>
                  <span
                    className={`font-mono text-lg font-bold tabular-nums ${timerColor} transition-colors`}
                  >
                    {timeLeft}s
                  </span>
                </div>
              </div>

              {/* Timer bar */}
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 linear"
                  style={{
                    width: `${timerBarPercent}%`,
                    background:
                      timeLeft <= 3
                        ? "#f87171"
                        : timeLeft <= 7
                          ? "#facc15"
                          : "#4ade80",
                  }}
                />
              </div>

              {/* Progress dots */}
              <div className="flex items-center justify-center gap-2 mt-3">
                {DEMO_QUESTIONS.map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      i < currentQ
                        ? answers[i] === DEMO_QUESTIONS[i].correctAnswer
                          ? "bg-green-400"
                          : "bg-red-400"
                        : i === currentQ
                          ? "bg-electric w-5"
                          : "bg-white/15"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Subject tag */}
            <div className="px-6 pb-2">
              <span className="inline-block px-2.5 py-1 rounded-md bg-electric/10 text-electric text-xs font-semibold">
                {question.subject}
              </span>
            </div>

            {/* Question */}
            <div className="px-6 pb-4">
              <h2 className="text-cream text-lg font-bold leading-snug">
                {question.question}
              </h2>
            </div>

            {/* Options */}
            <div className="px-6 pb-6 space-y-3">
              {question.options.map((opt, idx) => {
                let btnClass =
                  "w-full text-left px-5 py-4 rounded-xl border text-sm font-semibold transition-all duration-200";

                if (showCorrect) {
                  if (idx === question.correctAnswer) {
                    btnClass +=
                      " bg-green-400/15 border-green-400/50 text-green-400";
                  } else if (idx === selected && idx !== question.correctAnswer) {
                    btnClass +=
                      " bg-red-400/15 border-red-400/50 text-red-400";
                  } else {
                    btnClass +=
                      " bg-white/3 border-white/10 text-cream/30";
                  }
                } else if (selected === idx) {
                  btnClass +=
                    " bg-electric/15 border-electric text-electric";
                } else {
                  btnClass +=
                    " bg-white/5 border-white/10 text-cream/80 hover:bg-white/10 hover:border-electric/40 active:scale-[0.98]";
                }

                const letter = String.fromCharCode(65 + idx); // A, B, C, D

                return (
                  <button
                    key={idx}
                    onClick={() => handleSelect(idx)}
                    disabled={locked}
                    className={btnClass}
                  >
                    <span className="inline-flex items-center gap-3">
                      <span
                        className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          showCorrect && idx === question.correctAnswer
                            ? "bg-green-400/20 text-green-400"
                            : showCorrect &&
                                idx === selected &&
                                idx !== question.correctAnswer
                              ? "bg-red-400/20 text-red-400"
                              : "bg-white/10 text-cream/50"
                        }`}
                      >
                        {showCorrect && idx === question.correctAnswer
                          ? "✓"
                          : showCorrect &&
                              idx === selected &&
                              idx !== question.correctAnswer
                            ? "✗"
                            : letter}
                      </span>
                      {opt}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── RESULTS SCREEN ── */}
        {phase === "results" && (
          <div
            className="rounded-2xl border border-electric/20 p-8 text-center animate-slide-up"
            style={{
              background:
                "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
            }}
          >
            <div className="text-6xl mb-4">
              {score === totalQuestions
                ? "🏆"
                : score >= 3
                  ? "🔥"
                  : "💪"}
            </div>

            <h1 className="font-bebas text-4xl text-cream tracking-wider mb-2">
              {score === totalQuestions
                ? "Perfect Score!"
                : score >= 3
                  ? "Great Job!"
                  : "Keep Grinding!"}
            </h1>

            <p className="text-cream/50 text-sm mb-6">
              You scored {score} out of {totalQuestions}
            </p>

            {/* Score ring */}
            <div className="relative w-32 h-32 mx-auto mb-8">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  strokeWidth="8"
                  fill="none"
                  className="stroke-white/10"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  className={
                    score === totalQuestions
                      ? "stroke-gold"
                      : score >= 3
                        ? "stroke-green-400"
                        : "stroke-electric"
                  }
                  strokeDasharray={`${(score / totalQuestions) * 314} 314`}
                  style={{ transition: "stroke-dasharray 1s ease-out" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-bebas text-3xl text-cream">
                  {score}/{totalQuestions}
                </span>
                <span className="text-cream/30 text-xs">correct</span>
              </div>
            </div>

            {/* Per-question breakdown */}
            <div className="space-y-2 mb-8 text-left">
              {DEMO_QUESTIONS.map((q, i) => {
                const correct = answers[i] === q.correctAnswer;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/5"
                  >
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        correct
                          ? "bg-green-400/20 text-green-400"
                          : "bg-red-400/20 text-red-400"
                      }`}
                    >
                      {correct ? "✓" : "✗"}
                    </span>
                    <span className="text-cream/70 text-sm truncate flex-1">
                      {q.question}
                    </span>
                    <span
                      className={`text-xs font-semibold flex-shrink-0 ${
                        correct ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {correct
                        ? "Correct"
                        : answers[i] === null
                          ? "Time up"
                          : "Wrong"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* CTA */}
            <Link
              href="/login?tab=signup"
              className="block w-full py-4 rounded-xl font-bold text-base text-center transition-all duration-200 active:scale-[0.98]"
              style={{
                background:
                  "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                color: "#04080F",
                boxShadow: "0 4px 20px rgba(240,180,41,0.35)",
              }}
            >
              Create Your Free Account
            </Link>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={restart}
                className="flex-1 py-3 rounded-xl font-bold text-sm border border-electric/30 text-cream/70 hover:text-cream hover:border-electric/60 transition-all duration-200"
              >
                Try Again
              </button>
              <Link
                href="/login"
                className="flex-1 py-3 rounded-xl font-bold text-sm text-center bg-electric/10 text-electric border border-electric/20 hover:bg-electric/20 transition-all duration-200"
              >
                Log In
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
