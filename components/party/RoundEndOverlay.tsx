"use client";

// RoundEndOverlay — full-screen "round won" / "time's up" celebration card.
//
// Mounted at the SketchView root via <AnimatePresence>. Visible whenever the
// SketchView's local `phase === "celebrating"` state is set (which itself is
// set by the ROUND_ENDED broadcast — see SketchView for the server-pushed
// state machine). Holds for ~2.5s on screen, then SketchView advances the
// phase to "reveal" + dismisses the overlay.
//
// Two visual states:
//   State A — `winner !== null`: gold-ring winner avatar + headline
//             "ROUND WON BY {NAME}" + "word: {word}".
//   State B — `winner === null`: orange hourglass glyph + "TIME'S UP" +
//             "word: {word}".
//
// Accessibility: role="status" + aria-live="polite" so screen readers
// announce the outcome. Esc key dismisses local-only (server phase still
// advances on its own clock). prefers-reduced-motion = fade only, no scale.
//
// Spec: docs/specs/sketchy-layout-design.md §2. Copy locked, no em-dashes.

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Confetti from "@/components/Confetti";
import RevealText from "@/components/RevealText";

interface RoundEndOverlayProps {
  /** null = time's up (no one guessed). Object = winner attribution. */
  winner: {
    user_id: string;
    username: string | null;
    avatar_url?: string | null;
  } | null;
  /** The secret word that was being drawn — revealed at round end. */
  word: string;
  /** ISO timestamp for when the celebrating phase began (for local visual hold). */
  startedAt: string;
  /** Local-only dismiss callback. Server phase still advances on its own clock. */
  onEscape?: () => void;
}

export default function RoundEndOverlay({
  winner,
  word,
  startedAt: _startedAt,
  onEscape,
}: RoundEndOverlayProps) {
  void _startedAt; // accepted per spec; visual hold is owned upstream
  const reduced = useReducedMotion();
  // Winner-state confetti — fires once on mount, then stays mounted as a
  // no-op so a parent <AnimatePresence> can dismiss the overlay cleanly
  // without canceling mid-flight particles. Time's-up state skips.
  const [confettiTrigger, setConfettiTrigger] = useState(false);
  useEffect(() => {
    if (winner && !reduced) {
      // Small delay so the avatar pop-in lands first, THEN the burst.
      const t = setTimeout(() => setConfettiTrigger(true), 240);
      return () => clearTimeout(t);
    }
  }, [winner, reduced]);

  // Esc to dismiss locally. Server phase still advances on its own clock —
  // this just lets a viewer pop the overlay off their screen early if they
  // want to.
  useEffect(() => {
    if (!onEscape) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onEscape]);

  // Avatar fallback: dicebear seeded on username so it's stable per-user
  // across surfaces (matches the engineering non-negotiables).
  const winnerName = winner?.username ?? "SOMEONE";
  const avatarSrc = useMemo(() => {
    if (!winner) return "";
    if (winner.avatar_url) return winner.avatar_url;
    const seed = winner.username ?? winner.user_id;
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=4A90D9`;
  }, [winner]);

  const ariaLabel = winner
    ? `Round won by ${winnerName}. The word was ${word}.`
    : `Time is up. The word was ${word}.`;

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={ariaLabel}
      initial={reduced ? { opacity: 0 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#04080F]/82 backdrop-blur-md"
      style={{ pointerEvents: "auto" }}
    >
      {/* Winner-only confetti burst, gold + purple palette, 80 particles
          falling from the top edge. Time's-up state skips for tonal reasons. */}
      {winner && (
        <Confetti
          trigger={confettiTrigger}
          count={80}
          origin="top"
          duration={2200}
          palette={["#FFD700", "#FDE68A", "#A855F7", "#E9D5FF"]}
          onComplete={() => setConfettiTrigger(false)}
        />
      )}

      {/* Radial halo behind the card — purple for winner, orange for timeout. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: winner
            ? "radial-gradient(circle at center, rgba(168,85,247,0.18), transparent 60%)"
            : "radial-gradient(circle at center, rgba(249,115,22,0.16), transparent 60%)",
        }}
      />

      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 4 }}
        transition={{
          duration: reduced ? 0.18 : 0.42,
          ease: [0.16, 1, 0.3, 1],
        }}
        className="relative flex flex-col items-center gap-4 px-8 py-10 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl max-w-md mx-4"
        style={{
          boxShadow: winner
            ? "0 0 60px rgba(168,85,247,0.25)"
            : "0 0 60px rgba(249,115,22,0.22)",
        }}
      >
        {winner ? (
          // STATE A — winner avatar with gold ring.
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: reduced ? 0.18 : 0.4,
              delay: reduced ? 0 : 0.12,
              ease: [0.25, 1, 0.5, 1],
            }}
            className="relative w-24 h-24 rounded-full overflow-hidden ring-2 ring-[#FFD700]/60"
            style={{
              boxShadow: "0 0 24px rgba(255,215,0,0.35)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarSrc}
              alt={`${winnerName} avatar`}
              className="w-full h-full object-cover bg-navy"
            />
          </motion.div>
        ) : (
          // STATE B — hourglass glyph.
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, rotateZ: -180 }}
            animate={{ opacity: 1, rotateZ: 0 }}
            transition={{
              duration: reduced ? 0.18 : 0.55,
              delay: reduced ? 0 : 0.08,
              ease: [0.25, 1, 0.5, 1],
            }}
            className="relative w-[72px] h-[72px] rounded-full flex items-center justify-center text-orange-300"
            style={{
              background: "rgba(249,115,22,0.15)",
              border: "1px solid rgba(251,146,60,0.4)",
            }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              width="36"
              height="36"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 2h12" />
              <path d="M6 22h12" />
              <path d="M6 2l6 8 6-8" />
              <path d="M6 22l6-8 6 8" />
            </svg>
          </motion.div>
        )}

        <motion.h2
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reduced ? 0.18 : 0.34,
            delay: reduced ? 0 : 0.18,
            ease: [0.16, 1, 0.3, 1],
          }}
          className={`font-bebas text-4xl md:text-5xl tracking-wider text-center ${
            winner ? "text-cream" : "text-orange-200"
          }`}
        >
          {winner ? `ROUND WON BY ${winnerName.toUpperCase()}` : "TIME'S UP"}
        </motion.h2>

        {/* Word reveal — each character types in with a tiny stagger so the
            answer lands like a stamp, not a static label. Reduced motion
            renders the full word at once. */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reduced ? 0.18 : 0.3,
            delay: reduced ? 0 : 0.26,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="font-dm-mono text-sm text-cream/60 inline-flex items-center gap-1"
          aria-label={`word: ${word}`}
        >
          <span className="text-cream/40">word:</span>
          <RevealText
            text={word.toUpperCase()}
            color={winner ? "#FFD700" : "#FCA5A5"}
            glow={winner ? "0 0 8px rgba(255,215,0,0.45)" : "0 0 6px rgba(252,165,165,0.35)"}
            delay={0.32}
            charDelay={0.06}
            charDuration={0.18}
            className="font-bebas text-base tracking-[0.05em]"
          />
        </motion.div>

        {/* Footer strip with two flanking shimmer dots. */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: reduced ? 0.18 : 0.3,
            delay: reduced ? 0 : 0.34,
          }}
          className="flex items-center gap-2 mt-1"
        >
          <span aria-hidden="true" className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`w-1 h-1 rounded-full bg-cream/45 ${reduced ? "" : "pa-ink-dot"}`}
                style={reduced ? undefined : { animationDelay: `${i * 200}ms` }}
              />
            ))}
          </span>
          <span className="font-syne text-[11px] tracking-[0.3em] text-cream/35">
            NEXT ROUND
          </span>
          <span aria-hidden="true" className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`w-1 h-1 rounded-full bg-cream/45 ${reduced ? "" : "pa-ink-dot"}`}
                style={reduced ? undefined : { animationDelay: `${i * 200 + 100}ms` }}
              />
            ))}
          </span>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
