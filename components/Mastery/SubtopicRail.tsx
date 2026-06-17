"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Right-rail list of subtopic mastery bars. Each row shows the subtopic
 * name, its weight (as a small chip), and a thin progress bar that
 * smooth-fills to the current display percentage.
 *
 * The "currently drilling" subtopic gets a gold left-border accent so the
 * user can always see where Ninny's focus is.
 */

export interface SubtopicRailItem {
  id: string;
  name: string;
  weight: number;        // 0..1
  displayPct: number;    // 0..100
  attempts: number;
}

interface Props {
  items: SubtopicRailItem[];
  activeSubtopicId?: string | null;
  className?: string;
}

export default function SubtopicRail({ items, activeSubtopicId, className = "" }: Props) {
  // Sort by weight desc so the most important subtopics are at the top
  const sorted = [...items].sort((a, b) => b.weight - a.weight);

  return (
    <aside className={`flex flex-col gap-3 ${className}`}>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50">
        Subtopics
      </h3>
      <ul className="flex flex-col gap-2">
        {sorted.map(s => (
          <SubtopicRow key={s.id} item={s} active={s.id === activeSubtopicId} />
        ))}
      </ul>
    </aside>
  );
}

function SubtopicRow({ item, active }: { item: SubtopicRailItem; active: boolean }) {
  const reducedMotion = useReducedMotion();
  const [displayed, setDisplayed] = useState(item.displayPct);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(item.displayPct);

  // Subtopic-mastered celebration. Tracks the LAST known target value (not
  // the eased display) so the threshold crossing fires exactly once when the
  // server reports ≥95%, not on every easing tick.
  const lastTargetRef = useRef(item.displayPct);
  const [celebrateKey, setCelebrateKey] = useState(0);
  useEffect(() => {
    const prev = lastTargetRef.current;
    const next = item.displayPct;
    lastTargetRef.current = next;
    if (prev < 95 && next >= 95) {
      setCelebrateKey((k) => k + 1);
    }
  }, [item.displayPct]);

  useEffect(() => {
    // Reduced motion: snap to the real value, no rAF tween.
    if (reducedMotion) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setDisplayed(item.displayPct);
      return;
    }
    fromRef.current = displayed;
    const target = item.displayPct;
    const start = performance.now();
    const dur = 800;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(fromRef.current + (target - fromRef.current) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.displayPct, reducedMotion]);

  const pct = Math.max(0, Math.min(100, displayed));
  const mastered = pct >= 95;
  const barColor = mastered ? "#FFD700" : pct >= 60 ? "#4A90D9" : pct >= 30 ? "#A855F7" : "#EF4444";
  const realPct = Math.round(Math.max(0, Math.min(100, item.displayPct)));

  return (
    <li
      className={`
        relative pl-3 pr-2 py-2 rounded-[6px] border transition-all duration-300
        ${active
          ? "bg-gold/[0.06] border-gold/30"
          : mastered
            ? "bg-gold/[0.04] border-gold/25"
            : "bg-white/[0.02] border-white/[0.05] hover:border-white/[0.1]"}
      `}
    >
      {active && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-gold"
          aria-hidden="true"
        />
      )}
      {/* One-shot celebration ring — keyed on celebrateKey so it remounts (and
          re-fires) every time the subtopic crosses from <95% to ≥95%. The
          parent row already has overflow visible, so the ring expands beyond
          the card edge. */}
      {celebrateKey > 0 && (
        <span
          key={`celebrate-${celebrateKey}`}
          aria-hidden="true"
          className="absolute inset-0 rounded-[6px] pointer-events-none pa-mastery-halo"
          style={{ animationIterationCount: "3" }}
        />
      )}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[13px] text-cream/90 leading-tight truncate block">{item.name}</span>
        {mastered ? (
          <span
            key={`badge-${celebrateKey}`}
            className={`font-bebas text-[9px] tracking-[0.18em] px-1.5 py-0.5 rounded-full flex-shrink-0 ${celebrateKey > 0 ? "pa-pop-in" : ""}`}
            style={{
              background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
              color: "#04080F",
              boxShadow: "0 0 8px rgba(255,215,0,0.45)",
            }}
          >
            LOCKED
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="font-mono text-[10px] tabular-nums text-cream/55 flex-shrink-0"
          >
            {realPct}%
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={realPct}
        aria-label={`${item.name} mastery${active ? " (currently drilling)" : ""}`}
        aria-valuetext={`${realPct} percent${mastered ? ", mastered" : ""}`}
        className="h-[3px] rounded-full bg-white/[0.05] overflow-hidden"
      >
        <div
          aria-hidden="true"
          className="h-full rounded-full transition-[background-color] duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </li>
  );
}
