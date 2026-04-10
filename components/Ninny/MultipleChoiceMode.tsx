"use client";

import { useState, useEffect } from "react";
import { cdnUrl } from "@/lib/cdn";
import type { MCQQuestion } from "@/lib/ninny";

export interface NinnyWrongAnswer {
  question: string;
  correctAnswer: string;
  userAnswer: string;
  explanation?: string;
}

interface Props {
  questions: MCQQuestion[];
  onComplete: (result: {
    score: number;
    total: number;
    wrongAnswers: NinnyWrongAnswer[];
  }) => void;
}

export default function MultipleChoiceMode({ questions, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState<NinnyWrongAnswer[]>([]);

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
          userAnswer: current.options[i],
          explanation: current.explanation,
        },
      ]);
    }
  };

  const handleNext = () => {
    if (isLast) {
      onComplete({ score, total: questions.length, wrongAnswers });
    } else {
      setIndex((i) => i + 1);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-up">
      {/* Progress + score chip */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-bebas text-cream/60 text-sm tracking-wider">
          Question {index + 1} of {questions.length}
        </span>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
          style={{
            background: "rgba(255,215,0,0.08)",
            borderColor: "rgba(255,215,0,0.3)",
          }}
        >
          <img src={cdnUrl("/F.png")} alt="" className="w-3.5 h-3.5 object-contain" />
          <span className="font-bebas text-gold text-xs tracking-wider">
            {score}
          </span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-8">
        <div
          className="h-full bg-gold transition-all duration-300"
          style={{
            width: `${((index + 1) / questions.length) * 100}%`,
            background: "linear-gradient(90deg, #FFD700 0%, #F0C000 100%)",
          }}
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
              "border-white/10 bg-white/5 text-cream hover:border-gold/50 hover:bg-gold/5 active:scale-[0.99]";
          }

          return (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              disabled={revealed}
              className={cls}
            >
              <span className="font-bebas text-gold mr-3 tracking-wider">
                {String.fromCharCode(65 + i)}
              </span>
              {opt}
            </button>
          );
        })}
      </div>

      {/* Explanation */}
      {revealed && current.explanation && (
        <div
          className="rounded-xl border px-4 py-3 mb-6 animate-slide-up"
          style={{
            background: "rgba(168,85,247,0.06)",
            borderColor: "rgba(168,85,247,0.25)",
          }}
        >
          <p className="font-syne text-cream/80 text-sm leading-relaxed">
            {current.explanation}
          </p>
        </div>
      )}

      {/* Next button — gold, consistent with main CTA */}
      {revealed && (
        <button
          onClick={handleNext}
          className="w-full font-bebas text-base tracking-wider px-6 py-3.5 rounded-xl
            transition-all duration-200 active:scale-[0.99] animate-slide-up
            hover:brightness-110"
          style={{
            background: "linear-gradient(135deg, #FFD700 0%, #F0C000 100%)",
            color: "#04080F",
            boxShadow: "0 0 20px rgba(255,215,0,0.2)",
          }}
        >
          {isLast ? "Finish" : "Next →"}
        </button>
      )}
    </div>
  );
}
