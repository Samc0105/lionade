"use client";

import { useState, useEffect } from "react";
import { cdnUrl } from "@/lib/cdn";
import type { TrueFalseQuestion } from "@/lib/ninny";
import type { NinnyWrongAnswer } from "./MultipleChoiceMode";

interface Props {
  questions: TrueFalseQuestion[];
  onComplete: (result: { score: number; total: number; wrongAnswers: NinnyWrongAnswer[] }) => void;
}

const NINNY_PURPLE = "#A855F7";

export default function TrueFalseMode({ questions, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState<NinnyWrongAnswer[]>([]);

  const current = questions[index];
  const isLast = index === questions.length - 1;

  useEffect(() => {
    setSelected(null);
  }, [index]);

  if (!current) {
    return <div className="text-cream/60 text-center py-12">No questions available.</div>;
  }

  const handleAnswer = (answer: boolean) => {
    if (selected !== null) return;
    setSelected(answer);
    const correct = answer === current.answer;
    if (correct) {
      setScore((s) => s + 1);
    } else {
      setWrongAnswers((w) => [
        ...w,
        {
          question: current.statement,
          correctAnswer: current.answer ? "True" : "False",
          userAnswer: answer ? "True" : "False",
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

  const userIsCorrect = selected !== null && selected === current.answer;

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-up">
      {/* Progress + score chip */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-bebas text-cream/60 text-sm tracking-wider">
          Statement {index + 1} of {questions.length}
        </span>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
          style={{
            background: "rgba(255,215,0,0.08)",
            borderColor: "rgba(255,215,0,0.3)",
          }}
        >
          <img src={cdnUrl("/F.png")} alt="" className="w-3.5 h-3.5 object-contain" />
          <span className="font-bebas text-gold text-xs tracking-wider">{score}</span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-8">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${((index + 1) / questions.length) * 100}%`,
            background: "linear-gradient(90deg, #FFD700 0%, #F0C000 100%)",
          }}
        />
      </div>

      {/* Statement card */}
      <div
        className="rounded-2xl border-2 backdrop-blur p-6 sm:p-8 mb-6 text-center"
        style={{
          background: "rgba(255,255,255,0.04)",
          borderColor: `${NINNY_PURPLE}25`,
          minHeight: "180px",
        }}
      >
        <p className="font-bebas text-[10px] tracking-widest uppercase text-cream/40 mb-4">
          True or False?
        </p>
        <p className="font-bebas text-cream text-2xl sm:text-3xl tracking-wide leading-snug">
          {current.statement}
        </p>
      </div>

      {/* T / F buttons — large tap targets */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {([true, false] as const).map((value) => {
          const isSelected = selected === value;
          const isThisCorrect = value === current.answer;
          const showResult = selected !== null;

          let bg = "rgba(255,255,255,0.04)";
          let border = "rgba(255,255,255,0.10)";
          let color = "#EEF4FF";
          let glow = "none";

          if (showResult) {
            if (isThisCorrect) {
              bg = "rgba(34,197,94,0.15)";
              border = "rgba(34,197,94,0.55)";
              color = "#86EFAC";
              glow = "0 0 24px rgba(34,197,94,0.20)";
            } else if (isSelected) {
              bg = "rgba(239,68,68,0.15)";
              border = "rgba(239,68,68,0.55)";
              color = "#FCA5A5";
            } else {
              color = "rgba(238,244,255,0.30)";
            }
          }

          return (
            <button
              key={String(value)}
              onClick={() => handleAnswer(value)}
              disabled={selected !== null}
              className="font-bebas text-3xl tracking-widest py-8 rounded-2xl border-2
                transition-all duration-200 active:scale-[0.98]"
              style={{
                background: bg,
                borderColor: border,
                color,
                boxShadow: glow,
              }}
            >
              {value ? "TRUE" : "FALSE"}
            </button>
          );
        })}
      </div>

      {/* Explanation + next */}
      {selected !== null && (
        <div className="space-y-3 animate-slide-up">
          {current.explanation && (
            <div
              className="rounded-xl border px-4 py-3"
              style={{
                background: userIsCorrect ? "rgba(34,197,94,0.06)" : `${NINNY_PURPLE}10`,
                borderColor: userIsCorrect ? "rgba(34,197,94,0.25)" : `${NINNY_PURPLE}30`,
              }}
            >
              <p className="font-syne text-cream/80 text-sm leading-relaxed">
                {current.explanation}
              </p>
            </div>
          )}
          <button
            onClick={handleNext}
            className="w-full font-bebas text-base tracking-wider px-6 py-3.5 rounded-xl
              transition-all duration-200 active:scale-[0.99] hover:brightness-110"
            style={{
              background: "linear-gradient(135deg, #FFD700 0%, #F0C000 100%)",
              color: "#04080F",
              boxShadow: "0 0 20px rgba(255,215,0,0.20)",
            }}
          >
            {isLast ? "Finish" : "Next →"}
          </button>
        </div>
      )}
    </div>
  );
}
