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
  /**
   * "sm" (default) renders the compact bar used in the exam list. "lg"
   * renders a taller bar + bigger Bebas % readout for the in-session header,
   * where progress is the centerpiece. "lg" also enables ambient gold-
   * particle drift inside the fill once the bar is past 6%.
   */
  size?: "sm" | "lg";
}

const EASE = (t: number) => 1 - Math.pow(1 - t, 3);

export default function MasteryProgressBar({
  value, readyThreshold = 0.80, label, className = "", size = "sm",
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
  // Re-key the shimmer span every time the target value increases so the
  // pa-progress-shimmer animation re-fires. Static / decreasing values
  // skip the shimmer (no positive-progress beat to celebrate).
  const lastTargetRef = useRef(value);
  const [shimmerKey, setShimmerKey] = useState(0);
  useEffect(() => {
    if (value > lastTargetRef.current) {
      setShimmerKey((k) => k + 1);
    }
    lastTargetRef.current = value;
  }, [value]);

  const mastered = pct >= 95;
  const isLg = size === "lg";
  const showParticles = isLg && pct > 6;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {label && (
        <span
          className={`font-mono uppercase tracking-[0.25em] text-cream/55 shrink-0 ${
            isLg ? "text-[11px]" : "text-[10px] text-cream/50"
          }`}
        >
          {label}
        </span>
      )}
      <div
        className={`relative flex-1 rounded-full bg-white/[0.06] overflow-visible ${
          isLg ? "h-[9px]" : "h-[6px]"
        }`}
      >
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[background-color] duration-700 overflow-hidden ${mastered ? "pa-mastery-halo" : ""}`}
          style={{
            width: `${pct}%`,
            backgroundColor: color,
          }}
        >
          {/* Diagonal gold sweep that fires on every positive-progress tick.
              Keyed so React re-mounts the span and the animation restarts. */}
          {shimmerKey > 0 && (
            <span
              key={shimmerKey}
              aria-hidden="true"
              className="absolute inset-0 pa-progress-shimmer pointer-events-none"
              style={{
                background:
                  "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%)",
              }}
            />
          )}
          {showParticles && (
            <>
              <span aria-hidden="true" className="mastery-particle" style={{ animationDelay: "0s" }} />
              <span aria-hidden="true" className="mastery-particle" style={{ animationDelay: "1.1s", top: "30%" }} />
              <span aria-hidden="true" className="mastery-particle" style={{ animationDelay: "2.2s", top: "65%" }} />
            </>
          )}
        </div>
        {/* Ready-threshold notch */}
        <div
          className={`absolute w-[1.5px] bg-cream/30 ${isLg ? "top-[-4px] bottom-[-4px]" : "top-[-3px] bottom-[-3px]"}`}
          style={{ left: `${thresholdLeft}%` }}
          title={`${thresholdLeft}% · likely ready to pass`}
          aria-hidden="true"
        />
      </div>
      <span
        className={`font-bebas tabular-nums tracking-wider text-cream shrink-0 text-right ${
          isLg ? "text-[26px] w-[64px] leading-none" : "text-[18px] w-[46px]"
        }`}
      >
        {Math.round(pct)}%
      </span>
    </div>
  );
}
