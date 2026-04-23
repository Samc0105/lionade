"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Thin horizontal progress bar pinned to the top of the Mastery Mode view.
 *
 * Design notes:
 *   - Slow-fill: the bar value is visually tweened over ~900ms via rAF on
 *     every update. BKT moves on its own; the tween just makes the motion
 *     look earned instead of jumpy.
 *   - Color transitions: rose → electric → gold as you approach ready/mastery.
 *   - Ready-threshold mark: a small vertical notch at 80% so the user sees
 *     the target they're shooting for.
 */

interface Props {
  value: number;           // 0..100
  readyThreshold?: number; // 0..1, default 0.80
  label?: string;
  className?: string;
}

const EASE = (t: number) => 1 - Math.pow(1 - t, 3);

export default function MasteryProgressBar({
  value, readyThreshold = 0.80, label, className = "",
}: Props) {
  const [displayed, setDisplayed] = useState(value);
  const fromRef = useRef(value);
  const toRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = displayed;
    toRef.current = value;
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = EASE(t);
      const next = fromRef.current + (toRef.current - fromRef.current) * eased;
      setDisplayed(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pct = Math.max(0, Math.min(100, displayed));
  const color =
    pct >= 95 ? "#FFD700" :
    pct >= Math.round(readyThreshold * 100) ? "#FFD700" :
    pct >= 50 ? "#4A90D9" :
    pct >= 20 ? "#A855F7" :
    "#EF4444";

  const thresholdLeft = Math.round(readyThreshold * 100);

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {label && (
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 shrink-0">
          {label}
        </span>
      )}
      <div className="relative flex-1 h-[6px] rounded-full bg-white/[0.06] overflow-visible">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[background-color] duration-700"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            boxShadow: pct >= 95 ? `0 0 10px ${color}` : "none",
          }}
        />
        {/* Ready-threshold notch */}
        <div
          className="absolute top-[-3px] bottom-[-3px] w-[1.5px] bg-cream/30"
          style={{ left: `${thresholdLeft}%` }}
          title={`${thresholdLeft}% — likely ready to pass`}
          aria-hidden="true"
        />
      </div>
      <span className="font-bebas text-[18px] tabular-nums tracking-wider text-cream shrink-0 w-[46px] text-right">
        {Math.round(pct)}%
      </span>
    </div>
  );
}
