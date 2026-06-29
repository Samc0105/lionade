"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Target, Lightning } from "@phosphor-icons/react";
import LionDesk from "@/components/liondesk/LionDesk";
import AchievementBanner from "@/components/liondesk/AchievementBanner";
import { generateWeakSpotsShift } from "@/lib/liondesk/generate";
import { recordShiftResult } from "@/lib/liondesk/stats";
import { recordPlayDay } from "@/lib/liondesk/playstreak";
import {
  getConceptMastery,
  getWeakestConcepts,
  recordShiftResultConcepts,
  hasMasteryData,
  conceptLabel,
  type ConceptMasteryRow,
  type MasteryLevel,
} from "@/lib/liondesk/conceptMastery";
import type { Shift } from "@/lib/liondesk/types";

const LEVEL_COLOR: Record<MasteryLevel, string> = {
  none: "#6B7280",
  weak: "#EF4444",
  ok: "#4A90D9",
  strong: "#2BBE6B",
};
const LEVEL_LABEL: Record<MasteryLevel, string> = {
  none: "No data yet",
  weak: "Needs work",
  ok: "Getting there",
  strong: "Solid",
};

export default function WeakSpotsReview() {
  // localStorage mastery only exists on the client. Read after mount so SSR and
  // the first paint never show a misleading zero (the "mounted" flag guards it).
  const [mounted, setMounted] = useState(false);
  const [rows, setRows] = useState<ConceptMasteryRow[]>([]);
  const [weakIds, setWeakIds] = useState<string[]>([]);
  const [hasData, setHasData] = useState(false);

  const [shift, setShift] = useState<Shift | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [newAch, setNewAch] = useState<string[]>([]);

  function refresh() {
    setRows(getConceptMastery());
    setWeakIds(getWeakestConcepts(3));
    setHasData(hasMasteryData());
  }

  useEffect(() => {
    setMounted(true);
    refresh();
  }, []);

  function start() {
    const weak = getWeakestConcepts(3);
    setShift(generateWeakSpotsShift({ weakConcepts: weak, name: "Weak Spots" }));
    setRunKey((k) => k + 1);
  }
  function exit() {
    setShift(null);
    refresh();
  }

  /* ── playing the review shift ── */
  if (shift) {
    return (
      <div className="space-y-3">
        <button
          onClick={exit}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-cream/55 hover:text-[#C9A2F2] transition-colors"
        >
          <ArrowLeft size={14} weight="bold" aria-hidden="true" /> back to review
        </button>
        <AchievementBanner ids={newAch} />
        <LionDesk
          key={`${shift.id}-${runKey}`}
          shift={shift}
          onComplete={(r) => {
            recordPlayDay();
            recordShiftResultConcepts(shift, r);
            setNewAch(recordShiftResult(shift, r));
            refresh();
          }}
          onReplay={start}
          onExit={exit}
        />
        <p className="font-mono text-[10px] text-cream/40">
          A fresh draw of your weak spots every time. Fangs and XP shown on a solve are a preview, granted server side once a solve is validated.
        </p>
      </div>
    );
  }

  /* ── the mastery dashboard ── */
  const focusLabels = weakIds.map(conceptLabel);

  return (
    <div className="space-y-5">
      {/* Intro / focus card */}
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{
          background: "linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(239,68,68,0.07) 55%, rgba(12,16,32,0.95) 100%)",
          border: "1px solid rgba(168,85,247,0.28)",
        }}
      >
        <div className="flex items-center gap-2">
          <Target size={18} weight="fill" color="#C9A2F2" aria-hidden="true" />
          <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">YOUR WEAK SPOTS</h2>
        </div>
        <p className="text-cream/60 text-[12px] mt-1.5 leading-relaxed">
          {mounted
            ? hasData
              ? "Mastery is tracked per concept from the shifts you finish. A Weak Spots shift loads more tickets from the concepts you miss most, so practice goes where it counts."
              : "Finish a few shifts to map your strengths. Start a review now and it will begin tracking your mastery, then bias future reviews toward your weak spots."
            : "Loading your mastery..."}
        </p>

        {mounted && hasData && focusLabels.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">focus</span>
            {focusLabels.map((label) => (
              <span
                key={label}
                className="font-mono text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: "rgba(239,68,68,0.14)", color: "#F8B4B4", border: "1px solid rgba(239,68,68,0.34)" }}
              >
                {label}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={start}
          className="mt-4 px-5 py-2.5 min-h-[44px] rounded-xl font-bold text-sm text-[#04060c] inline-flex items-center gap-2"
          style={{ background: "linear-gradient(135deg,#A855F7,#EF4444)" }}
        >
          <Lightning size={16} weight="fill" aria-hidden="true" />
          {mounted && hasData ? "Start Weak Spots shift" : "Start a review shift"}
        </button>
      </div>

      {/* Per-concept mastery */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-2">mastery by concept</p>
        <ul className="space-y-2.5">
          {(mounted ? rows : SKELETON).map((row, i) => {
            const skeleton = !mounted;
            const color = LEVEL_COLOR[skeleton ? "none" : row.level];
            const width = skeleton ? 0 : row.pct ?? 0;
            const isFocus = mounted && weakIds.includes(row.concept);
            return (
              <li
                key={skeleton ? i : row.concept}
                className="rounded-xl border bg-white/[0.02] p-3"
                style={{ borderColor: isFocus ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.08)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-cream/90 text-[13px] font-semibold">{skeleton ? "…" : row.label}</span>
                  {isFocus && (
                    <span className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.16)", color: "#F8B4B4" }}>
                      focus
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[11px] tabular-nums" style={{ color }}>
                    {skeleton ? "…" : row.pct === null ? "No data yet" : `${row.pct}%`}
                  </span>
                </div>

                <div className="mt-2 h-2 w-full rounded-full overflow-hidden bg-white/[0.06]" role="img" aria-label={skeleton ? "loading" : `${row.label}: ${row.pct === null ? "no data yet" : `${row.pct}% mastery`}`}>
                  <div
                    className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700 ease-out"
                    style={{ width: `${width}%`, background: color }}
                  />
                </div>

                {!skeleton && (
                  <p className="mt-1.5 font-mono text-[10px] text-cream/40">
                    {row.total === 0
                      ? "Not handled yet. Start a review to begin tracking."
                      : `${LEVEL_LABEL[row.level]} · ${row.correct} of ${row.total} handled${row.total < 3 ? " (still learning)" : ""}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <p className="font-mono text-[10px] text-cream/40 leading-relaxed">
        Mastery is a personal practice signal stored on this device. It tracks nothing toward your balance (the economy stays server authoritative).
      </p>
    </div>
  );
}

// Skeleton placeholders so the list has shape before mount, never a row of zeros.
const SKELETON: ConceptMasteryRow[] = Array.from({ length: 9 }).map(() => ({
  concept: "",
  label: "",
  correct: 0,
  total: 0,
  pct: null,
  confident: false,
  level: "none",
}));
