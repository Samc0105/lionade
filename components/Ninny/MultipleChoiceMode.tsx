"use client";

import { useState, useEffect } from "react";
import type { MCQQuestion } from "@/lib/ninny";

interface WrongAnswer {
  question: string;
  correctAnswer: string;
}

interface Props {
  questions: MCQQuestion[];
  onComplete: (result: { score: number; total: number; wrongAnswers: WrongAnswer[] }) => void;
}

export default function MultipleChoiceMode({ questions, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState<WrongAnswer[]>([]);

  const current = questions[index];
  const isLast = index === questions.length - 1;

  useEffect(() => {
    setSelected(null);
    setRevealed(false);
  }, [index]);

  if (!current) {
    return (
      <div className="text-cream/60 text-center py-12">
        No questions available.
      </div>
    );
  }

  const handleSelect = (i: number) => {
    if (revealed) return;
    setSelected(i);
    setRevealed(true);
    if (i === current.correctIndex) {
      setScore((s) => s + 1);
    } else {
      setWrongAnswers((w) => [
        ...w,
        {
          question: current.question,
          correctAnswer: current.options[current.correctIndex],
        },
      ]);
    }
  };

  const handleNext = () => {
    if (isLast) {
      onComplete({
        score: score,
        total: questions.length,
        wrongAnswers,
      });
    } else {
      setIndex((i) => i + 1);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-up">
      {/* Progress */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-bebas text-cream/60 text-sm tracking-wider">
          Question {index + 1} of {questions.length}
        </span>
        <span className="font-bebas text-electric text-sm tracking-wider">
          Score {score}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-8">
        <div
          className="h-full bg-electric transition-all duration-300"
          style={{ width: `${((index + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question card */}
      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 mb-6">
        <p className="font-bebas text-cream text-2xl tracking-wide leading-snug">
          {current.question}
        </p>
      </div>

      {/* Options */}
      <div className="space-y-3 mb-6">
        {current.options.map((opt, i) => {
          const isSelected = selected === i;
          const isCorrect = i === current.correctIndex;
          let cls =
            "w-full text-left px-4 py-3.5 rounded-xl border font-syne text-sm transition-all duration-200 ";

          if (revealed) {
            if (isCorrect) {
              cls += "border-green-400/60 bg-green-400/10 text-cream";
            } else if (isSelected) {
              cls += "border-red-400/60 bg-red-400/10 text-cream/70";
            } else {
              cls += "border-white/10 bg-white/5 text-cream/40";
            }
          } else {
            cls +=
              "border-white/10 bg-white/5 text-cream hover:border-electric/50 hover:bg-electric/5 active:scale-[0.99]";
          }

          return (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              disabled={revealed}
              className={cls}
            >
              <span className="font-bebas text-electric mr-3 tracking-wider">
                {String.fromCharCode(65 + i)}
              </span>
              {opt}
            </button>
          );
        })}
      </div>

      {/* Explanation */}
      {revealed && current.explanation && (
        <div className="rounded-xl border border-electric/20 bg-electric/5 p-4 mb-6 animate-slide-up">
          <p className="font-syne text-cream/80 text-sm leading-relaxed">
            {current.explanation}
          </p>
        </div>
      )}

      {/* Next button */}
      {revealed && (
        <button
          onClick={handleNext}
          className="w-full font-syne font-bold text-base px-6 py-3.5 rounded-xl
            bg-electric text-navy hover:bg-electric-light transition-all duration-200
            active:scale-[0.99] animate-slide-up"
        >
          {isLast ? "Finish" : "Next →"}
        </button>
      )}
    </div>
  );
}
