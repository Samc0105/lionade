"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { cdnUrl } from "@/lib/cdn";
import { weightedShuffle, type FillBlankQuestion } from "@/lib/ninny";
import type { NinnyWrongAnswer } from "./MultipleChoiceMode";

interface Props {
  questions: FillBlankQuestion[];
  wrongAnswerCounts?: Map<string, number>;
  onComplete: (result: { score: number; total: number; wrongAnswers: NinnyWrongAnswer[] }) => void;
}

const NINNY_PURPLE = "#A855F7";

// Lenient comparison: ignore case, trim, strip punctuation
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[.,!?;:'"]/g, "");
}

export default function FillBlankMode({ questions, wrongAnswerCounts, onComplete }: Props) {
  const orderedQuestions = useMemo(() => {
    if (!wrongAnswerCounts || wrongAnswerCounts.size === 0) return questions;
    return weightedShuffle(questions, (q) => q.sentence, wrongAnswerCounts, questions.length);
  }, [questions, wrongAnswerCounts]);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [score, setScore] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState<NinnyWrongAnswer[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = orderedQuestions[index];
  const isLast = index === orderedQuestions.length - 1;

  useEffect(() => {
    setInput("");
    setRevealed(false);
    setWasCorrect(false);
    inputRef.current?.focus();
  }, [index]);

  if (!current) {
    return <div className="text-cream/60 text-center py-12">No questions available.</div>;
  }

  // Render the sentence with the blank highlighted
  const parts = current.sentence.split("___");

  const handleSubmit = () => {
    if (revealed || !input.trim()) return;
    const correct = normalize(input) === normalize(current.answer);
    setWasCorrect(correct);
    setRevealed(true);
    if (correct) {
      setScore((s) => s + 1);
    } else {
      setWrongAnswers((w) => [
        ...w,
        {
          question: current.sentence,
          correctAnswer: current.answer,
          userAnswer: input,
        },
      ]);
    }
  };

  const handleNext = () => {
    if (isLast) {
      onComplete({ score, total: orderedQuestions.length, wrongAnswers });
    } else {
      setIndex((i) => i + 1);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-up">
      {/* Progress + score chip */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-bebas text-cream/60 text-sm tracking-wider">
          Question {index + 1} of {orderedQuestions.length}
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
            width: `${((index + 1) / orderedQuestions.length) * 100}%`,
            background: "linear-gradient(90deg, #FFD700 0%, #F0C000 100%)",
          }}
        />
      </div>

      {/* Sentence card */}
      <div
        className="rounded-2xl border-2 backdrop-blur p-6 mb-6"
        style={{
          background: "rgba(255,255,255,0.04)",
          borderColor: revealed
            ? wasCorrect
              ? "rgba(34,197,94,0.45)"
              : "rgba(239,68,68,0.45)"
            : `${NINNY_PURPLE}25`,
        }}
      >
        <p className="font-bebas text-cream text-2xl sm:text-3xl tracking-wide leading-snug">
          {parts[0]}
          <span
            className="inline-block px-3 py-1 mx-1 rounded-lg align-baseline"
            style={{
              background: revealed
                ? wasCorrect
                  ? "rgba(34,197,94,0.20)"
                  : "rgba(239,68,68,0.20)"
                : `${NINNY_PURPLE}25`,
              border: revealed
                ? wasCorrect
                  ? "1px solid rgba(34,197,94,0.45)"
                  : "1px solid rgba(239,68,68,0.45)"
                : `1px dashed ${NINNY_PURPLE}55`,
              minWidth: "60px",
              color: revealed && !wasCorrect ? "#FCA5A5" : revealed ? "#86EFAC" : NINNY_PURPLE,
            }}
          >
            {revealed ? current.answer : "_____"}
          </span>
          {parts[1] ?? ""}
        </p>
      </div>

      {/* Input or feedback */}
      {!revealed ? (
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Type your answer..."
            className="w-full bg-white/5 backdrop-blur border rounded-xl px-4 py-3.5
              text-cream font-syne text-base placeholder:text-cream/30 focus:outline-none
              focus:border-purple-500/50 transition-colors"
            style={{ borderColor: `${NINNY_PURPLE}30` }}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="w-full font-bebas text-base tracking-wider px-6 py-3.5 rounded-xl
              transition-all duration-200 active:scale-[0.99] hover:brightness-110
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
            style={{
              background: "linear-gradient(135deg, #FFD700 0%, #F0C000 100%)",
              color: "#04080F",
              boxShadow: "0 0 20px rgba(255,215,0,0.20)",
            }}
          >
            Submit
          </button>
        </div>
      ) : (
        <div className="space-y-3 animate-slide-up">
          {!wasCorrect && (
            <div
              className="rounded-xl border px-4 py-3"
              style={{
                background: "rgba(239,68,68,0.08)",
                borderColor: "rgba(239,68,68,0.30)",
              }}
            >
              <p className="text-cream/60 text-xs font-syne uppercase tracking-wider mb-1">
                Your answer
              </p>
              <p className="text-red-400/90 font-syne text-sm">{input}</p>
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
