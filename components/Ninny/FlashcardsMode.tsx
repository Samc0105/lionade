"use client";

import { useState, useMemo } from "react";
import { cdnUrl } from "@/lib/cdn";
import { weightedShuffle, type Flashcard } from "@/lib/ninny";
import type { NinnyWrongAnswer } from "./MultipleChoiceMode";

interface Props {
  cards: Flashcard[];
  wrongAnswerCounts?: Map<string, number>;
  onComplete: (result: { score: number; total: number; wrongAnswers: NinnyWrongAnswer[] }) => void;
}

export default function FlashcardsMode({ cards, wrongAnswerCounts, onComplete }: Props) {
  // Spaced-repetition shuffle: missed cards appear with higher probability
  const deck = useMemo(() => {
    if (wrongAnswerCounts && wrongAnswerCounts.size > 0) {
      return weightedShuffle(cards, (c) => c.front, wrongAnswerCounts, cards.length);
    }
    return [...cards].sort(() => Math.random() - 0.5);
  }, [cards, wrongAnswerCounts]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState<NinnyWrongAnswer[]>([]);

  const current = deck[index];
  const isLast = index === deck.length - 1;

  if (!current) {
    return (
      <div className="text-cream/60 text-center py-12">No flashcards available.</div>
    );
  }

  const finish = (newScore: number, newWrongs: NinnyWrongAnswer[]) => {
    onComplete({ score: newScore, total: deck.length, wrongAnswers: newWrongs });
  };

  const handleKnewIt = () => {
    const newScore = score + 1;
    setScore(newScore);
    if (isLast) {
      finish(newScore, wrongAnswers);
    } else {
      setIndex((i) => i + 1);
      setFlipped(false);
    }
  };

  const handleDidntKnow = () => {
    const newWrongs = [
      ...wrongAnswers,
      {
        question: current.front,
        correctAnswer: current.back,
        userAnswer: "(didn't know)",
      },
    ];
    setWrongAnswers(newWrongs);
    if (isLast) {
      finish(score, newWrongs);
    } else {
      setIndex((i) => i + 1);
      setFlipped(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-up">
      {/* Progress + score chip */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-bebas text-cream/60 text-sm tracking-wider">
          Card {index + 1} of {deck.length}
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
            width: `${((index + 1) / deck.length) * 100}%`,
            background: "linear-gradient(90deg, #FFD700 0%, #F0C000 100%)",
          }}
        />
      </div>

      {/* Flip card */}
      <div
        className="relative mx-auto mb-6"
        style={{ perspective: "1200px", maxWidth: "640px" }}
      >
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          className="block w-full h-72 sm:h-80 cursor-pointer focus:outline-none"
          style={{ transformStyle: "preserve-3d" }}
          aria-label={flipped ? "Show front of card" : "Show back of card"}
        >
          <div
            className="absolute inset-0 transition-transform duration-500"
            style={{
              transformStyle: "preserve-3d",
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 rounded-2xl border-2 backdrop-blur p-8 flex flex-col items-center justify-center text-center"
              style={{
                backfaceVisibility: "hidden",
                background: "linear-gradient(135deg, rgba(168,85,247,0.10) 0%, rgba(168,85,247,0.05) 100%)",
                borderColor: "rgba(168,85,247,0.40)",
                boxShadow: "0 0 40px rgba(168,85,247,0.15)",
              }}
            >
              <p
                className="font-bebas text-[10px] tracking-widest uppercase mb-3"
                style={{ color: "#A855F7" }}
              >
                Term
              </p>
              <p className="font-bebas text-cream text-3xl sm:text-4xl tracking-wide leading-snug">
                {current.front}
              </p>
              <p className="font-syne text-cream/30 text-xs mt-6">Tap to reveal</p>
            </div>

            {/* Back */}
            <div
              className="absolute inset-0 rounded-2xl border-2 backdrop-blur p-8 flex flex-col items-center justify-center text-center"
              style={{
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
                background: "linear-gradient(135deg, rgba(255,215,0,0.10) 0%, rgba(255,215,0,0.04) 100%)",
                borderColor: "rgba(255,215,0,0.40)",
                boxShadow: "0 0 40px rgba(255,215,0,0.15)",
              }}
            >
              <p className="font-bebas text-[10px] tracking-widest uppercase mb-3 text-gold">
                Definition
              </p>
              <p className="font-syne text-cream text-base sm:text-lg leading-relaxed">
                {current.back}
              </p>
            </div>
          </div>
        </button>
      </div>

      {/* Action buttons (only after flip) */}
      <div
        className={`grid grid-cols-2 gap-3 transition-all duration-300 ${
          flipped ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
        }`}
      >
        <button
          onClick={handleDidntKnow}
          className="font-bebas text-base tracking-wider px-6 py-4 rounded-xl
            border transition-all duration-200 active:scale-[0.99] hover:brightness-110"
          style={{
            background: "rgba(239,68,68,0.10)",
            borderColor: "rgba(239,68,68,0.40)",
            color: "#FCA5A5",
          }}
        >
          Missed It
        </button>
        <button
          onClick={handleKnewIt}
          className="font-bebas text-base tracking-wider px-6 py-4 rounded-xl
            transition-all duration-200 active:scale-[0.99] hover:brightness-110"
          style={{
            background: "linear-gradient(135deg, #FFD700 0%, #F0C000 100%)",
            color: "#04080F",
            boxShadow: "0 0 20px rgba(255,215,0,0.20)",
          }}
        >
          I Knew It
        </button>
      </div>
    </div>
  );
}
