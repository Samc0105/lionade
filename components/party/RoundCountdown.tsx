"use client";

// RoundCountdown — shared between-rounds countdown overlay for Lionade Party.
//
// Game-agnostic: Poker Face mounts it today; Bluff Trivia consumes it next.
// Renders a full-screen dimmed overlay with a big number ticking down from
// `seconds` (default 5) above a "ROUND N" label. The parent mounts it when a
// fresh round begins and unmounts on `onComplete` (the component renders
// nothing once the count hits 0, so a slow unmount is harmless).
//
// Motion: each tick re-keys a framer spring (scale + opacity only, GPU
// compositor properties). prefers-reduced-motion = static numbers that still
// tick down once per second, no spring, no scale.

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface Props {
  /** 1-based round number for the "ROUND N" label. */
  roundNum: number;
  /** Optional total for "ROUND N OF M". */
  totalRounds?: number | null;
  /** The label word before the number (e.g. "ROUND", "QUESTION"). Default "ROUND". */
  label?: string;
  /** Countdown length in seconds. Default 5. */
  seconds?: number;
  /** Accent color for the big number + chip. */
  accent?: string;
  /** Optional headline above the number (e.g. who presents next). */
  headline?: React.ReactNode;
  /** Optional small line under the number. */
  subline?: React.ReactNode;
  /** Fired exactly once when the count reaches 0. Parent unmounts. */
  onComplete?: () => void;
}

export default function RoundCountdown({
  roundNum,
  totalRounds,
  label = "ROUND",
  seconds = 5,
  accent = "#4A90D9",
  headline,
  subline,
  onComplete,
}: Props) {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(seconds);
  const completedRef = useRef(false);

  useEffect(() => {
    if (count <= 0) {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count, onComplete]);

  if (count <= 0) return null;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="status"
      aria-live="polite"
      aria-label={`${label} ${roundNum}${totalRounds ? ` of ${totalRounds}` : ""} starting in ${count}`}
      className="fixed inset-0 z-40 flex flex-col items-center justify-center pointer-events-none"
      style={{
        background: "radial-gradient(circle, rgba(8,6,16,0.78) 0%, rgba(8,6,16,0.92) 100%)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <div className="flex flex-col items-center gap-2 mb-8 px-4 text-center">
        <span
          className="inline-flex items-center font-bebas text-xs tracking-[0.3em] px-3 py-1 rounded-full"
          style={{
            background: `${accent}2e`,
            border: `1px solid ${accent}73`,
            color: accent,
          }}
        >
          {label} {roundNum}
          {totalRounds ? ` OF ${totalRounds}` : ""}
        </span>
        {headline && (
          <p className="font-bebas text-3xl sm:text-4xl tracking-wider text-cream">{headline}</p>
        )}
      </div>
      {reduced ? (
        <p
          className="font-bebas text-[10rem] sm:text-[14rem] leading-none tracking-wider"
          style={{ color: accent }}
        >
          {count}
        </p>
      ) : (
        <motion.p
          key={`tick-${count}`}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 18 }}
          className="font-bebas text-[10rem] sm:text-[14rem] leading-none tracking-wider"
          style={{ color: accent, textShadow: `0 0 64px ${accent}80` }}
        >
          {count}
        </motion.p>
      )}
      {subline && (
        <p className="font-bebas text-sm tracking-[0.4em] text-cream/55 mt-6 px-4 text-center">
          {subline}
        </p>
      )}
    </motion.div>
  );
}
