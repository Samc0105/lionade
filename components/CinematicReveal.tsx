"use client";

// CinematicReveal — the "{word + confetti + halo}" trio packaged up.
//
// Recurring pattern across the codebase: a cinematic answer/result lands,
// the text types in via <RevealText>, a <Confetti /> burst fires from the
// top, and a soft radial halo washes the surrounding card. Sites that need
// this combination today:
//   - Sketchy RoundEndOverlay (winner-name word reveal)
//   - Bluff "THE TRUTH" reveal
//   - Poker Face "BLUFFED"/"HONEST" verdict
//   - Roardle "NICE!" win
//   - Pardy Final Tally PERFECT GAME (score has its own treatment, but the
//     surrounding tier band could use this)
//
// This composite gives a single drop-in for the next reveal site. Sites with
// special structure (multi-line copy, embedded buttons) keep using the parts
// separately; this is the easy path.

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import RevealText from "@/components/RevealText";
import Confetti from "@/components/Confetti";

interface Props {
  /** The hero text to reveal. */
  text: string;
  /** Color of the text + the halo + the confetti accent. Default gold. */
  accent?: string;
  /** Optional per-character text-shadow string. Defaults to a glow keyed on
   *  the accent. Pass empty string to disable. */
  glow?: string;
  /** Skip the confetti burst — useful when the surrounding card has its own
   *  celebration, or for tonal reasons (missed reveal, tough round). */
  noConfetti?: boolean;
  /** Number of confetti particles. Default 60. */
  confettiCount?: number;
  /** Confetti palette override. Defaults to gold + accent. */
  confettiPalette?: string[];
  /** Delay before the text reveal starts (seconds). Default 0.2s — gives the
   *  halo a beat to land first. */
  delay?: number;
  /** className applied to the wrapping <div>. */
  className?: string;
}

function hexToRgba(hex: string, a: number): string {
  // Accepts #RGB, #RRGGBB. Falls back to gold-ish if parse fails.
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return `rgba(255,215,0,${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function CinematicReveal({
  text,
  accent = "#FFD700",
  glow,
  noConfetti = false,
  confettiCount = 60,
  confettiPalette,
  delay = 0.2,
  className,
}: Props) {
  const reduced = useReducedMotion();
  const [confettiTrigger, setConfettiTrigger] = useState(false);

  // Fire confetti a beat after mount so it doesn't clobber the halo. Skipped
  // entirely when noConfetti or reduced motion.
  useEffect(() => {
    if (noConfetti || reduced) return;
    const t = setTimeout(() => setConfettiTrigger(true), delay * 1000 + 120);
    return () => clearTimeout(t);
  }, [noConfetti, reduced, delay]);

  const haloBg = `radial-gradient(circle at center, ${hexToRgba(accent, 0.22)} 0%, transparent 60%)`;
  const palette = confettiPalette ?? [accent, "#FFD700", "#FDE68A", "#FFFFFF"];
  const computedGlow = glow ?? (glow === "" ? "" : `0 0 10px ${hexToRgba(accent, 0.55)}`);

  return (
    <div className={`relative inline-flex items-center justify-center ${className ?? ""}`}>
      {/* Soft halo behind the text — purely decorative. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 -m-4 pointer-events-none"
        style={{ background: haloBg }}
      />

      {/* Confetti is fixed-positioned by its own component so it falls from
          the top of the viewport, not from this element's bounds. */}
      {!noConfetti && (
        <Confetti
          trigger={confettiTrigger}
          count={confettiCount}
          origin="top"
          duration={2200}
          palette={palette}
          onComplete={() => setConfettiTrigger(false)}
        />
      )}

      <span className="relative z-10">
        <RevealText
          text={text}
          color={accent}
          glow={computedGlow}
          delay={delay}
        />
      </span>
    </div>
  );
}
