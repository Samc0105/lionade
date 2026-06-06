"use client";

// RevealText — canonical per-character typewriter reveal used at every
// "cinematic answer lands" moment in the app: Sketchy's word stamp at round
// end, Bluff's truth string, Poker Face's BLUFFED/HONEST verdict, Mastery's
// CORRECT/MISSED, Roardle's NICE!. Same motion vocabulary everywhere.
//
// Reduced-motion users get the whole string at once with no animation.
//
// Why a dedicated component: the inline pattern got copy-pasted into 4
// surfaces before this refactor. Each site rebuilt the Array.from + map +
// motion.span scaffolding by hand. Centralizing makes the next reveal site
// (and the inevitable tuning request — "make the stagger snappier") a
// one-place edit.

import { useReducedMotion, motion } from "framer-motion";

interface Props {
  /** Text to type out. Whitespace is preserved. */
  text: string;
  /** Per-character color. Falls back to currentColor. */
  color?: string;
  /** Optional text-shadow glow string, applied per character. */
  glow?: string;
  /** Delay before the first character animates in (seconds). Default 0.15s. */
  delay?: number;
  /** Delay added between successive characters (seconds). Default 0.05s. */
  charDelay?: number;
  /** Per-character duration (seconds). Default 0.22s. */
  charDuration?: number;
  /** Optional className applied to the wrapping <span>. */
  className?: string;
  /** Optional aria-label override. Defaults to the text itself. */
  ariaLabel?: string;
}

export default function RevealText({
  text,
  color,
  glow,
  delay = 0.15,
  charDelay = 0.05,
  charDuration = 0.22,
  className,
  ariaLabel,
}: Props) {
  const reduced = useReducedMotion();
  const label = ariaLabel ?? text;

  if (reduced) {
    return (
      <span className={className} style={{ color }} aria-label={label}>
        {text}
      </span>
    );
  }

  return (
    <span className={className} aria-label={label}>
      {Array.from(text).map((c, i) => (
        <motion.span
          key={`${c}-${i}`}
          initial={{ opacity: 0, y: 6, scale: 0.7 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: charDuration,
            delay: delay + i * charDelay,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="inline-block"
          style={{
            color,
            textShadow: glow,
            // Preserve actual whitespace inside the span so multi-word
            // strings keep their spaces (motion.span renders inline-block).
            whiteSpace: c === " " ? "pre" : undefined,
          }}
        >
          {c}
        </motion.span>
      ))}
    </span>
  );
}
