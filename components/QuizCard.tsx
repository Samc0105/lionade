"use client";

import { useState, useEffect } from "react";
import CoinAnimation from "./CoinAnimation";

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

  const revealed = result !== null && selected !== null;

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
  const timerColor =
    timerPercent > 50 ? "#4A90D9" : timerPercent > 25 ? "#E67E22" : "#E74C3C";

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
        <span className="text-cream/50 text-sm font-semibold">
          Question {questionNumber} / {totalQuestions}
        </span>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border
              ${difficultyColor[difficultyLabel] || difficultyColor[question.difficulty] || ""}`}
          >
            {difficultyLabel}
          </span>
          <div className="flex items-center gap-1.5 bg-gold/10 border border-gold/30 rounded-full px-3 py-1">
            <span className="text-sm">🪙</span>
            <span className="font-bebas text-lg text-gold">+{coinReward}</span>
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

      {/* Timer Number */}
      <div className="flex justify-center mb-6">
        <div
          className="font-bebas text-5xl leading-none transition-all"
          style={{ color: timerColor, textShadow: `0 0 15px ${timerColor}80` }}
        >
          {timeLeft}
        </div>
      </div>

      {/* Question */}
      <div className="card mb-6">
        <p className="font-syne text-lg font-semibold text-cream leading-relaxed text-center">
          {question.question}
        </p>
      </div>

      {/* Options */}
      <div className="grid grid-cols-1 gap-3">
        {question.options.map((option, index) => {
          let optionClass =
            "w-full text-left px-5 py-4 rounded-xl border transition-all duration-300 font-semibold text-sm ";

          if (!revealed && !waiting) {
            optionClass +=
              "border-electric/20 bg-navy-50 hover:border-electric/60 hover:bg-electric/10 hover:-translate-y-0.5 cursor-pointer";
          } else if (waiting && !revealed) {
            // Waiting for server response
            optionClass += index === selected
              ? "border-electric/60 bg-electric/15 text-electric"
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

          return (
            <button
              key={index}
              onClick={() => handleSelect(index)}
              disabled={revealed || waiting}
              className={optionClass}
            >
              <div className="flex items-center gap-4">
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-bebas text-lg flex-shrink-0
                    ${!revealed
                      ? index === selected && waiting
                        ? "bg-electric/30 text-electric"
                        : "bg-electric/20 text-electric"
                      : index === result?.correctIndex
                      ? "bg-green-400/30 text-green-300"
                      : index === selected
                      ? "bg-red-400/30 text-red-300"
                      : "bg-white/5 text-cream/30"
                    }`}
                >
                  {revealed && result && index === result.correctIndex
                    ? "✓"
                    : revealed && index === selected && index !== result?.correctIndex
                    ? "✗"
                    : optionLabel}
                </span>
                <span>{option}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Explanation + Next */}
      {revealed && result?.explanation && (
        <div className="mt-4 p-4 rounded-xl border border-electric/20 bg-electric/5 animate-slide-up">
          <div className="flex items-start gap-2.5">
            <span className="text-lg flex-shrink-0">💡</span>
            <p className="text-cream/70 text-sm leading-relaxed">{result.explanation}</p>
          </div>
        </div>
      )}

      {revealed && (
        <button onClick={handleSkip}
          className="mt-4 w-full py-3 rounded-xl border border-electric/30 text-electric text-sm font-bold hover:bg-electric/10 transition-all">
          Next →
        </button>
      )}
    </div>
  );
}
