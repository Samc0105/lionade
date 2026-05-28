"use client";

// Competitive Arena — small Fang-coin burst that fires on a score gain.
//
// Purely presentational + self-contained. On each fresh `burstKey` (a number
// that the parent bumps when points are banked) it emits a handful of Fang
// coins that fly up + outward and fade (.ca-fang keyframe in globals.css).
// Reuses the existing reduced-motion gate: under reduced motion it renders
// nothing. Positioned ABSOLUTE over its anchor by the parent.

import { useMemo } from "react";
import { useReducedMotion } from "framer-motion";
import { cdnUrl } from "@/lib/cdn";

interface Coin {
  id: number;
  fx: number; // px horizontal drift
  fy: number; // px vertical rise (negative = up)
  delay: number;
  size: number;
}

function buildCoins(seed: number, count: number): Coin[] {
  // Deterministic per burst so re-renders within one burst don't reshuffle.
  let s = seed * 9301 + 49297;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    fx: Math.round(rand() * 88 - 44),
    fy: Math.round(-36 - rand() * 40),
    delay: Math.round(rand() * 90),
    size: 14 + Math.round(rand() * 8),
  }));
}

export default function FangBurst({ burstKey, count = 7 }: { burstKey: number; count?: number }) {
  const reduce = useReducedMotion();
  const coins = useMemo(() => buildCoins(burstKey, count), [burstKey, count]);

  if (reduce || burstKey === 0) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20" aria-hidden="true">
      {coins.map((c) => (
        <img
          key={`${burstKey}-${c.id}`}
          src={cdnUrl("/F.png")}
          alt=""
          className="ca-fang absolute object-contain"
          style={
            {
              width: `${c.size}px`,
              height: `${c.size}px`,
              animationDelay: `${c.delay}ms`,
              "--fx": `${c.fx}px`,
              "--fy": `${c.fy}px`,
            } as React.CSSProperties & Record<string, string>
          }
        />
      ))}
    </div>
  );
}
