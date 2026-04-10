"use client";

import { useState, useMemo, useEffect } from "react";
import { cdnUrl } from "@/lib/cdn";
import { weightedShuffle, type OrderingQuestion } from "@/lib/ninny";
import type { NinnyWrongAnswer } from "./MultipleChoiceMode";

interface Props {
  questions: OrderingQuestion[];
  wrongAnswerCounts?: Map<string, number>;
  onComplete: (result: { score: number; total: number; wrongAnswers: NinnyWrongAnswer[] }) => void;
}

const NINNY_PURPLE = "#A855F7";

interface SlotItem {
  index: number; // original index in question.items
  text: string;
}

export default function OrderingMode({ questions, wrongAnswerCounts, onComplete }: Props) {
  const orderedQuestions = useMemo(() => {
    if (!wrongAnswerCounts || wrongAnswerCounts.size === 0) return questions;
    return weightedShuffle(questions, (q) => q.prompt, wrongAnswerCounts, questions.length);
  }, [questions, wrongAnswerCounts]);
  const [questionIdx, setQuestionIdx] = useState(0);
  const [arrangement, setArrangement] = useState<SlotItem[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [score, setScore] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState<NinnyWrongAnswer[]>([]);

  const current = orderedQuestions[questionIdx];
  const isLast = questionIdx === orderedQuestions.length - 1;

  // Build the user-facing correct order: items[correctOrder[0]], items[correctOrder[1]], ...
  const correctSequence = useMemo(() => {
    if (!current) return [] as string[];
    return current.correctOrder.map((i) => current.items[i]).filter(Boolean);
  }, [current]);

  // Initialize/reset arrangement when question changes
  useEffect(() => {
    if (!current) return;
    const initial: SlotItem[] = current.items.map((text, index) => ({ index, text }));
    // Shuffle so the user has actual work to do
    const shuffled = [...initial].sort(() => Math.random() - 0.5);
    setArrangement(shuffled);
    setSelectedSlot(null);
    setRevealed(false);
    setWasCorrect(false);
  }, [current]);

  if (!current) {
    return <div className="text-cream/60 text-center py-12">No questions available.</div>;
  }

  const handleSlotClick = (slotIdx: number) => {
    if (revealed) return;
    if (selectedSlot === null) {
      setSelectedSlot(slotIdx);
    } else if (selectedSlot === slotIdx) {
      setSelectedSlot(null);
    } else {
      // Swap
      setArrangement((prev) => {
        const next = [...prev];
        [next[selectedSlot], next[slotIdx]] = [next[slotIdx], next[selectedSlot]];
        return next;
      });
      setSelectedSlot(null);
    }
  };

  const handleSubmit = () => {
    if (revealed) return;
    // Compare current arrangement to correct sequence
    const userOrder = arrangement.map((s) => s.text);
    const correct = userOrder.every((t, i) => t === correctSequence[i]);
    setWasCorrect(correct);
    setRevealed(true);
    if (correct) {
      setScore((s) => s + 1);
    } else {
      setWrongAnswers((w) => [
        ...w,
        {
          question: current.prompt,
          correctAnswer: correctSequence.join(" → "),
          userAnswer: userOrder.join(" → "),
        },
      ]);
    }
  };

  const handleNext = () => {
    if (isLast) {
      onComplete({ score, total: orderedQuestions.length, wrongAnswers });
    } else {
      setQuestionIdx((i) => i + 1);
    }
  };

  const slotStyle = (slotIdx: number) => {
    const isSelected = selectedSlot === slotIdx;
    if (revealed) {
      const isInCorrectPosition = arrangement[slotIdx]?.text === correctSequence[slotIdx];
      return {
        background: isInCorrectPosition ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
        borderColor: isInCorrectPosition ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)",
        color: "#EEF4FF",
      };
    }
    if (isSelected) {
      return {
        background: `${NINNY_PURPLE}22`,
        borderColor: `${NINNY_PURPLE}70`,
        color: "#EEF4FF",
        boxShadow: `0 0 24px ${NINNY_PURPLE}33`,
      };
    }
    return {
      background: "rgba(255,255,255,0.04)",
      borderColor: "rgba(255,255,255,0.10)",
      color: "rgba(238,244,255,0.85)",
    };
  };

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-up">
      {/* Progress + score chip */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-bebas text-cream/60 text-sm tracking-wider">
          Question {questionIdx + 1} of {orderedQuestions.length}
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
            width: `${((questionIdx + 1) / orderedQuestions.length) * 100}%`,
            background: "linear-gradient(90deg, #FFD700 0%, #F0C000 100%)",
          }}
        />
      </div>

      {/* Prompt */}
      <div
        className="rounded-2xl border bg-white/5 backdrop-blur p-5 mb-4"
        style={{ borderColor: `${NINNY_PURPLE}25` }}
      >
        <p className="font-bebas text-cream text-xl tracking-wide leading-snug">
          {current.prompt}
        </p>
      </div>

      <p className="font-syne text-cream/40 text-xs text-center mb-4">
        Tap two items to swap their positions
      </p>

      {/* Slots */}
      <div className="space-y-2 mb-6">
        {arrangement.map((item, slotIdx) => (
          <button
            key={`${item.index}-${slotIdx}`}
            onClick={() => handleSlotClick(slotIdx)}
            disabled={revealed}
            className="w-full text-left px-4 py-3.5 rounded-xl border-2 font-syne text-sm
              flex items-center gap-3 transition-all duration-200 active:scale-[0.99]"
            style={slotStyle(slotIdx)}
          >
            <span
              className="font-bebas text-lg w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: revealed
                  ? arrangement[slotIdx]?.text === correctSequence[slotIdx]
                    ? "rgba(34,197,94,0.20)"
                    : "rgba(239,68,68,0.20)"
                  : `${NINNY_PURPLE}25`,
                color: revealed
                  ? arrangement[slotIdx]?.text === correctSequence[slotIdx]
                    ? "#86EFAC"
                    : "#FCA5A5"
                  : NINNY_PURPLE,
              }}
            >
              {slotIdx + 1}
            </span>
            <span className="flex-1 leading-snug">{item.text}</span>
          </button>
        ))}
      </div>

      {!revealed ? (
        <button
          onClick={handleSubmit}
          className="w-full font-bebas text-base tracking-wider px-6 py-3.5 rounded-xl
            transition-all duration-200 active:scale-[0.99] hover:brightness-110"
          style={{
            background: "linear-gradient(135deg, #FFD700 0%, #F0C000 100%)",
            color: "#04080F",
            boxShadow: "0 0 20px rgba(255,215,0,0.20)",
          }}
        >
          Submit Order
        </button>
      ) : (
        <div className="space-y-3 animate-slide-up">
          {!wasCorrect && (
            <div
              className="rounded-xl border px-4 py-3"
              style={{
                background: "rgba(34,197,94,0.06)",
                borderColor: "rgba(34,197,94,0.25)",
              }}
            >
              <p className="font-syne text-cream/60 text-xs uppercase tracking-wider mb-1.5">
                Correct order
              </p>
              <p className="font-syne text-cream/80 text-sm leading-relaxed">
                {correctSequence.join(" → ")}
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
