"use client";

// Arena V2 — static emoji reaction tied to HP.
//
// Phase 2A ships unicode emoji (no PNG dependency). When V1.5 polish lands
// we can swap to PNGs at /public/arena-v2/emoji/* by gating on
// `usePng={true}` here.
//
// Reaction zones (from project_arena_v2_decisions.md):
//   100-70 → chill
//   69-40  → sweating
//   39-15  → panic
//   <15    → if you're the one dying = dying face; if your opponent is
//            dying and you are not = smug. The "smug" variant is decided
//            by the caller via `opponentHp` (optional).

import { motion, useReducedMotion } from "framer-motion";

interface EmojiReactionProps {
  /** This entity's HP (0-100). */
  hp: number;
  /** Opponent's HP — needed to decide between "dying" and "smug" at low HP. */
  opponentHp?: number;
  /** Larger size on the player's own avatar; smaller on the opponent. */
  size?: "sm" | "md" | "lg";
  /** Optional label below the emoji (e.g. anonymized handle). */
  caption?: string;
}

function pickEmoji(hp: number, opponentHp?: number) {
  if (hp <= 14) {
    if (opponentHp !== undefined && opponentHp <= 14 && hp > opponentHp) {
      return { glyph: "\u{1F60F}", aria: "smug" }; // 😏 winning the dying race
    }
    return { glyph: "\u{1F480}", aria: "dying" }; // 💀
  }
  if (hp <= 39) return { glyph: "\u{1F631}", aria: "panic" };       // 😱
  if (hp <= 69) return { glyph: "\u{1F605}", aria: "sweating" };    // 😅
  return { glyph: "\u{1F60E}", aria: "chill" };                     // 😎
}

export default function EmojiReaction({ hp, opponentHp, size = "md", caption }: EmojiReactionProps) {
  const reduced = useReducedMotion();
  const { glyph, aria } = pickEmoji(hp, opponentHp);

  const sizeClass = {
    sm: "text-3xl sm:text-4xl",
    md: "text-5xl sm:text-6xl",
    lg: "text-6xl sm:text-7xl",
  }[size];

  return (
    <div className="flex flex-col items-center gap-1">
      <motion.div
        key={aria}
        initial={reduced ? false : { scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 18 }}
        className={`${sizeClass} leading-none select-none`}
        role="img"
        aria-label={`Reaction: ${aria}`}
      >
        {glyph}
      </motion.div>
      {caption && (
        <p className="text-cream/50 text-[11px] sm:text-xs font-syne text-center max-w-[120px] truncate">
          {caption}
        </p>
      )}
    </div>
  );
}
