"use client";

import { useState, useMemo, useEffect } from "react";
import { cdnUrl } from "@/lib/cdn";
import { weightedShuffle, type MatchPair } from "@/lib/ninny";
import type { NinnyWrongAnswer } from "./MultipleChoiceMode";

interface Props {
  pairs: MatchPair[];
  wrongAnswerCounts?: Map<string, number>;
  onComplete: (result: { score: number; total: number; wrongAnswers: NinnyWrongAnswer[] }) => void;
}

interface Item {
  id: number;
  text: string;
  pairId: number;
  side: "term" | "definition";
}

const NINNY_PURPLE = "#A855F7";

export default function MatchMode({ pairs, wrongAnswerCounts, onComplete }: Props) {
  // Take 6 pairs at a time, weighted toward previously-missed pairs
  const round = useMemo(() => {
    const ordered =
      wrongAnswerCounts && wrongAnswerCounts.size > 0
        ? weightedShuffle(pairs, (p) => p.term, wrongAnswerCounts, pairs.length)
        : [...pairs].sort(() => Math.random() - 0.5);
    const shuffled = ordered.slice(0, 6);
    const terms: Item[] = shuffled.map((p, i) => ({
      id: i * 2,
      text: p.term,
      pairId: i,
      side: "term",
    }));
    const definitions: Item[] = shuffled
      .map((p, i) => ({
        id: i * 2 + 1,
        text: p.definition,
        pairId: i,
        side: "definition" as const,
      }))
      .sort(() => Math.random() - 0.5);
    return { total: shuffled.length, terms, definitions, source: shuffled };
  }, [pairs]);

  const [selectedTerm, setSelectedTerm] = useState<Item | null>(null);
  const [selectedDef, setSelectedDef] = useState<Item | null>(null);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [wrongFlash, setWrongFlash] = useState<{ termId: number; defId: number } | null>(null);
  const [score, setScore] = useState(0);
  const [wrongAnswers, setWrongAnswers] = useState<NinnyWrongAnswer[]>([]);

  // When both sides are selected, check if they match
  useEffect(() => {
    if (!selectedTerm || !selectedDef) return;

    if (selectedTerm.pairId === selectedDef.pairId) {
      // Correct
      setMatched((prev) => new Set(prev).add(selectedTerm.pairId));
      setScore((s) => s + 1);
      const t = setTimeout(() => {
        setSelectedTerm(null);
        setSelectedDef(null);
      }, 350);
      return () => clearTimeout(t);
    } else {
      // Wrong — flash red, log, then reset
      setWrongFlash({ termId: selectedTerm.id, defId: selectedDef.id });
      const pair = round.source[selectedTerm.pairId];
      setWrongAnswers((prev) => [
        ...prev,
        {
          question: pair.term,
          correctAnswer: pair.definition,
          userAnswer: selectedDef.text,
        },
      ]);
      const t = setTimeout(() => {
        setWrongFlash(null);
        setSelectedTerm(null);
        setSelectedDef(null);
      }, 700);
      return () => clearTimeout(t);
    }
  }, [selectedTerm, selectedDef, round.source]);

  // Auto-complete when all pairs matched
  useEffect(() => {
    if (matched.size === round.total && round.total > 0) {
      const t = setTimeout(() => {
        onComplete({ score, total: round.total, wrongAnswers });
      }, 600);
      return () => clearTimeout(t);
    }
  }, [matched, round.total, score, wrongAnswers, onComplete]);

  if (round.total === 0) {
    return <div className="text-cream/60 text-center py-12">No matches available.</div>;
  }

  const handleTermClick = (item: Item) => {
    if (matched.has(item.pairId)) return;
    setSelectedTerm(item);
  };
  const handleDefClick = (item: Item) => {
    if (matched.has(item.pairId)) return;
    setSelectedDef(item);
  };

  const itemStyle = (item: Item, isSelected: boolean) => {
    const isMatched = matched.has(item.pairId);
    const isWrong =
      wrongFlash &&
      (wrongFlash.termId === item.id || wrongFlash.defId === item.id);

    if (isMatched) {
      return {
        background: "rgba(34,197,94,0.10)",
        borderColor: "rgba(34,197,94,0.45)",
        color: "rgba(238,244,255,0.40)",
        cursor: "default",
      };
    }
    if (isWrong) {
      return {
        background: "rgba(239,68,68,0.15)",
        borderColor: "rgba(239,68,68,0.55)",
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
    <div className="w-full max-w-3xl mx-auto animate-slide-up">
      {/* Progress + score chip */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-bebas text-cream/60 text-sm tracking-wider">
          Matched {matched.size} of {round.total}
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
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-6">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${(matched.size / round.total) * 100}%`,
            background: "linear-gradient(90deg, #FFD700 0%, #F0C000 100%)",
          }}
        />
      </div>

      <p className="font-syne text-cream/40 text-xs text-center mb-5">
        Tap a term, then tap its definition
      </p>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Terms column */}
        <div className="space-y-2">
          <p className="font-bebas text-cream/40 text-[10px] tracking-widest uppercase mb-1.5">
            Terms
          </p>
          {round.terms.map((item) => (
            <button
              key={item.id}
              onClick={() => handleTermClick(item)}
              disabled={matched.has(item.pairId)}
              className="w-full text-left px-4 py-3 rounded-xl border font-syne text-sm
                transition-all duration-200 active:scale-[0.98]"
              style={itemStyle(item, selectedTerm?.id === item.id)}
            >
              {item.text}
            </button>
          ))}
        </div>

        {/* Definitions column */}
        <div className="space-y-2">
          <p className="font-bebas text-cream/40 text-[10px] tracking-widest uppercase mb-1.5">
            Definitions
          </p>
          {round.definitions.map((item) => (
            <button
              key={item.id}
              onClick={() => handleDefClick(item)}
              disabled={matched.has(item.pairId)}
              className="w-full text-left px-4 py-3 rounded-xl border font-syne text-sm
                transition-all duration-200 active:scale-[0.98] leading-snug"
              style={itemStyle(item, selectedDef?.id === item.id)}
            >
              {item.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
