"use client";

import { useState, useEffect } from "react";
import { Question } from "@/types";
import CoinAnimation from "./CoinAnimation";

interface QuizCardProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  timeLimit?: number;
  onAnswer: (answerIndex: number, isCorrect: boolean, timeLeft: number) => void;
}

export default function QuizCard({
  question,
  questionNumber,
  totalQuestions,
  timeLimit = 20,
  onAnswer,
}: QuizCardProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [showCoin, setShowCoin] = useState(false);
  const [advanceTimer, setAdvanceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSelected(null);
    setRevealed(false);
    setTimeLeft(timeLimit);
    setShowCoin(false);
    setAdvanceTimer(null);
  }, [question.id, timeLimit]);

  useEffect(() => {
    if (revealed) return;

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
  }, [revealed, question.id]);

  const handleSelect = (index: number) => {
    if (revealed) return;
    setSelected(index);
    setRevealed(true);

    const isCorrect = index === question.correctAnswer;
    if (isCorrect) setShowCoin(true);

    const t = setTimeout(() => {
      onAnswer(index, isCorrect, timeLeft);
      setShowCoin(false);
    }, question.explanation ? 3000 : 1400);
    setAdvanceTimer(t);
  };

  const handleSkip = () => {
    if (!revealed) return;
    if (advanceTimer) clearTimeout(advanceTimer);
    const isCorrect = (selected ?? -1) === question.correctAnswer;
    onAnswer(selected ?? -1, isCorrect, timeLeft);
    setShowCoin(false);
  };

  const timerPercent = (timeLeft / timeLimit) * 100;
  const timerColor =
    timerPercent > 50
      ? "#4A90D9"
      : timerPercent > 25
      ? "#E67E22"
      : "#E74C3C";

  const difficultyColor = {
    easy: "text-green-400 border-green-400/50 bg-green-400/10",
    medium: "text-yellow-400 border-yellow-400/50 bg-yellow-400/10",
    hard: "text-red-400 border-red-400/50 bg-red-400/10",
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <CoinAnimation
        trigger={showCoin}
        amount={question.coinReward}
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
              ${difficultyColor[question.difficulty]}`}
          >
            {question.difficulty}
          </span>
          <div className="flex items-center gap-1.5 bg-gold/10 border border-gold/30 rounded-full px-3 py-1">
            <span className="text-sm">🪙</span>
            <span className="font-bebas text-lg text-gold">+{question.coinReward}</span>
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
          style={{
            color: timerColor,
            textShadow: `0 0 15px ${timerColor}80`,
          }}
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

          if (!revealed) {
            optionClass +=
              "border-electric/20 bg-navy-50 hover:border-electric/60 hover:bg-electric/10 hover:-translate-y-0.5 cursor-pointer";
          } else if (index === question.correctAnswer) {
            optionClass +=
              "border-green-400 bg-green-400/15 text-green-300 shadow-lg shadow-green-400/20";
          } else if (index === selected && index !== question.correctAnswer) {
            optionClass += "border-red-400 bg-red-400/15 text-red-300";
          } else {
            optionClass += "border-electric/10 bg-navy-50/50 text-cream/40 cursor-not-allowed";
          }

          const optionLabel = ["A", "B", "C", "D"][index];

          return (
            <button
              key={index}
              onClick={() => handleSelect(index)}
              disabled={revealed}
              className={optionClass}
            >
              <div className="flex items-center gap-4">
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center font-bebas text-lg flex-shrink-0
                    ${!revealed
                      ? "bg-electric/20 text-electric"
                      : index === question.correctAnswer
                      ? "bg-green-400/30 text-green-300"
                      : index === selected
                      ? "bg-red-400/30 text-red-300"
                      : "bg-white/5 text-cream/30"
                    }`}
                >
                  {revealed && index === question.correctAnswer
                    ? "✓"
                    : revealed && index === selected && index !== question.correctAnswer
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
      {revealed && question.explanation && (
        <div className="mt-4 p-4 rounded-xl border border-electric/20 bg-electric/5 animate-slide-up">
          <div className="flex items-start gap-2.5">
            <span className="text-lg flex-shrink-0">💡</span>
            <p className="text-cream/70 text-sm leading-relaxed">{question.explanation}</p>
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
