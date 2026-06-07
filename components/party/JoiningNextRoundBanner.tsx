"use client";

// Spectator-mode banner shown to a mid-game joiner.
// Their is_pending_round flag is true until the next ROUND_STARTED, when the
// server clears it; the View hosting this banner watches the players list
// and unmounts the banner when their own player.is_pending_round flips.

import { motion } from "framer-motion";
import { Eye } from "@phosphor-icons/react";

interface Props {
  variant?: "sketch" | "bluff" | "pokerface";
}

const COPY: Record<NonNullable<Props["variant"]>, { title: string; sub: string; accent: string }> = {
  sketch: {
    title: "You're in. Joining next round.",
    sub: "Watch this one play out. You'll be eligible to guess as soon as the next word is picked.",
    accent: "#A855F7",
  },
  bluff: {
    title: "You're in. Joining next round.",
    sub: "Watch this round wrap up. You'll write fakes and vote on the next question.",
    accent: "#FFD700",
  },
  pokerface: {
    title: "You're in. Joining next round.",
    sub: "Sit out this hand. You'll be dealt in on the next presenter.",
    accent: "#00BFFF",
  },
};

export default function JoiningNextRoundBanner({ variant = "sketch" }: Props) {
  const copy = COPY[variant];
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 rounded-2xl px-4 py-3 flex items-start gap-3"
      style={{
        background: `linear-gradient(135deg, ${copy.accent}22 0%, ${copy.accent}08 100%)`,
        border: `1px solid ${copy.accent}55`,
      }}
    >
      <span
        className="flex-shrink-0 w-9 h-9 rounded-full grid place-items-center"
        style={{ background: `${copy.accent}33`, border: `1px solid ${copy.accent}66` }}
      >
        <Eye size={16} weight="fill" aria-hidden="true" color={copy.accent} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-cream text-sm font-bold tracking-wide">{copy.title}</p>
        <p className="text-cream/55 text-xs mt-0.5">{copy.sub}</p>
      </div>
    </motion.div>
  );
}
