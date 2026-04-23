"use client";

import { useEffect, useRef, useState } from "react";

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
  const [displayed, setDisplayed] = useState(item.displayPct);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(item.displayPct);

  useEffect(() => {
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
  }, [item.displayPct]);

  const pct = Math.max(0, Math.min(100, displayed));
  const barColor = pct >= 95 ? "#FFD700" : pct >= 60 ? "#4A90D9" : pct >= 30 ? "#A855F7" : "#EF4444";

  return (
    <li
      className={`
        relative pl-3 pr-2 py-2 rounded-[6px] border transition-all duration-300
        ${active
          ? "bg-gold/[0.06] border-gold/30"
          : "bg-white/[0.02] border-white/[0.05] hover:border-white/[0.1]"}
      `}
    >
      {active && (
        <span
          className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-gold"
          aria-hidden="true"
        />
      )}
      <div className="mb-1.5">
        <span className="text-[13px] text-cream/90 leading-tight truncate block">{item.name}</span>
      </div>
      <div className="h-[3px] rounded-full bg-white/[0.05] overflow-hidden">
        <div
          className="h-full rounded-full transition-[background-color] duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </li>
  );
}
