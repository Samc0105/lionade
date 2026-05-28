"use client";

// Competitive Arena — pre-round 3-2-1-GO countdown overlay.
//
// Purely presentational + self-contained. Renders a full-surface (NOT
// full-viewport-flash) dim scrim with a large ticking number that scales down
// and fades on each beat (.ca-count-tick keyframe in globals.css). After the
// final "GO!" tick it calls onDone() and unmounts. Respects reduced motion:
// when motion is reduced we skip straight to onDone() on the next frame so the
// round starts immediately with no flashing numbers.

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

const SEQUENCE = ["3", "2", "1", "GO!"];
const BEAT_MS = 800;

export default function Countdown({ accent, onDone }: { accent: string; onDone: () => void }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  // Keep the latest onDone in a ref so the per-beat timer effect can depend ONLY
  // on `step`/`reduce`. Parents tick frequently (e.g. Sabotage's 100ms clock) and
  // pass a fresh onDone each render; without this the 800ms timer would reset on
  // every parent render and the countdown would never advance.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (reduce) {
      // No countdown theatre under reduced motion — start the round now.
      const id = requestAnimationFrame(() => onDoneRef.current());
      return () => cancelAnimationFrame(id);
    }
    if (step >= SEQUENCE.length) {
      onDoneRef.current();
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), BEAT_MS);
    return () => clearTimeout(t);
  }, [step, reduce]);

  if (reduce || step >= SEQUENCE.length) return null;

  const label = SEQUENCE[step];
  const isGo = label === "GO!";

  return (
    <div
      className="absolute inset-0 z-[40] flex items-center justify-center pointer-events-none"
      style={{ background: "rgba(4,6,13,0.55)" }}
      aria-hidden="true"
    >
      <span
        key={step}
        className="ca-count-tick font-bebas leading-none"
        style={{
          fontSize: isGo ? "clamp(4rem, 18vw, 11rem)" : "clamp(5rem, 22vw, 14rem)",
          color: isGo ? accent : "var(--cream, #f5e9d0)",
          textShadow: `0 0 40px ${accent}66`,
        }}
      >
        {label}
      </span>
    </div>
  );
}
