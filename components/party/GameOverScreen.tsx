"use client";

// GameOverScreen — shared end-of-game final scoreboard for Lionade Party.
//
// Game-agnostic: Poker Face mounts it today; Bluff Trivia consumes it next.
// Renders the final standings with podium treatment for 1st/2nd/3rd
// (gold/silver/bronze), an OPTIONAL Fang payout slot (Party V1 is zero-Fang,
// so the slot renders nothing unless `fangPayoutLine` is provided), and the
// post-game CTAs:
//   - "PLAY AGAIN"     -> parent wires to POST /api/party/rooms/[code]/rematch
//   - "BACK TO LOBBY"  -> parent wires to its existing end-game flow
// CTAs are host-only (the rematch + end-game routes are host-gated); non-host
// players see a quiet "Waiting for host" pill instead.
//
// Motion: staggered slide-up rows + a one-shot confetti burst for the winner.
// All transform/opacity (GPU compositor); prefers-reduced-motion = static.

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import CountUp from "@/components/CountUp";

// Confetti is dynamic-imported so the canvas particle code only ships when a
// game actually ends (same rationale as RoundEndOverlay).
const Confetti = dynamic(() => import("@/components/Confetti"), { ssr: false });

interface GameOverPlayer {
  user_id: string;
  username: string | null;
  score: number;
}

interface Props {
  players: GameOverPlayer[];
  meUserId: string;
  /** Game accent color (Poker Face = electric blue). */
  accent?: string;
  isHost: boolean;
  /** Host CTA: fresh game, same roster. Wire to the rematch route. */
  onPlayAgain: () => void | Promise<void>;
  /** Host CTA: back to the lobby. Wire to the end-game flow. */
  onBackToLobby: () => void | Promise<void>;
  /** Disables Play Again while the rematch request is in flight. */
  playAgainPending?: boolean;
  /** Optional Fang payout line. Party V1 is zero-Fang: omit to render nothing. */
  fangPayoutLine?: React.ReactNode;
  /** Game-specific extras (e.g. Poker Face awards) rendered above the CTAs. */
  children?: React.ReactNode;
}

const PLACEMENT = [
  { label: "1ST", color: "#FFD700", glow: "rgba(255,215,0,0.35)" },   // gold
  { label: "2ND", color: "#C0C0C0", glow: "rgba(192,192,192,0.25)" }, // silver
  { label: "3RD", color: "#CD7F32", glow: "rgba(205,127,50,0.25)" },  // bronze
] as const;

export default function GameOverScreen({
  players,
  meUserId,
  accent = "#4A90D9",
  isHost,
  onPlayAgain,
  onBackToLobby,
  playAgainPending = false,
  fangPayoutLine,
  children,
}: Props) {
  const reduced = useReducedMotion();
  const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const podium = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  // One-shot winner confetti, slightly delayed so the podium pop lands first.
  const [confettiTrigger, setConfettiTrigger] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setConfettiTrigger(true), 350);
    return () => clearTimeout(t);
  }, [reduced]);

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-4"
      role="region"
      aria-label="Game over. Final standings."
    >
      <Confetti
        trigger={confettiTrigger}
        count={90}
        origin="top"
        duration={2400}
        palette={["#FFD700", "#FDE68A", accent, "#A855F7"]}
        onComplete={() => setConfettiTrigger(false)}
      />

      <div className="text-center space-y-1 pt-2">
        <p className="font-bebas text-xs tracking-[0.35em]" style={{ color: accent }}>
          FINAL STANDINGS
        </p>
        <h2 className="font-bebas text-4xl sm:text-5xl tracking-wider text-cream">GAME OVER</h2>
      </div>

      {/* ── Podium: 1st / 2nd / 3rd ── */}
      <div className="space-y-2">
        {podium.map((p, i) => {
          const pl = PLACEMENT[i];
          const isMe = p.user_id === meUserId;
          return (
            <motion.div
              key={p.user_id}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0 : 0.4, delay: reduced ? 0 : i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              className={`rounded-2xl px-4 flex items-center justify-between ${i === 0 ? "py-4" : "py-3"} ${i === 0 && !reduced ? "pa-leader-glow" : ""}`}
              style={{
                background: `linear-gradient(135deg, ${pl.color}${i === 0 ? "2e" : "1a"} 0%, rgba(8,6,16,0.6) 100%)`,
                border: `1px solid ${pl.color}${i === 0 ? "8c" : "59"}`,
                boxShadow: i === 0 ? `0 0 24px ${pl.glow}` : "none",
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`font-bebas tracking-wider ${i === 0 ? "text-xl" : "text-base"}`}
                  style={{ color: pl.color, textShadow: `0 0 12px ${pl.glow}` }}
                >
                  {i === 0 ? "\u{1F451} " : ""}{pl.label}
                </span>
                <span className={`font-syne text-cream/90 truncate ${i === 0 ? "text-base sm:text-lg" : "text-sm"}`}>
                  {p.username ?? "Player"}
                  {isMe && <span className="text-cream/40 text-xs"> (you)</span>}
                </span>
              </div>
              <span
                className={`font-bebas tracking-wider ${i === 0 ? "text-2xl" : "text-lg"}`}
                style={{ color: pl.color }}
              >
                <CountUp value={p.score ?? 0} duration={800} />
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* ── Everyone else ── */}
      {rest.length > 0 && (
        <div className="space-y-1.5">
          {rest.map((p, i) => {
            const isMe = p.user_id === meUserId;
            return (
              <motion.div
                key={p.user_id}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.35, delay: reduced ? 0 : 0.36 + i * 0.06 }}
                className="rounded-xl px-4 py-2 flex items-center justify-between"
                style={{
                  background: isMe ? "rgba(168,85,247,0.1)" : "rgba(255,255,255,0.03)",
                  border: isMe ? "1px solid rgba(168,85,247,0.3)" : "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-bebas text-xs text-cream/40 w-7">{i + 4}TH</span>
                  <span className="font-syne text-sm text-cream/80 truncate">
                    {p.username ?? "Player"}
                    {isMe && <span className="text-cream/40 text-xs"> (you)</span>}
                  </span>
                </div>
                <span className="font-bebas text-base text-cream/70 tracking-wider tabular-nums">
                  {p.score ?? 0}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Optional Fang payout slot (Party V1 = zero-Fang, renders nothing) ── */}
      {fangPayoutLine && (
        <div
          className="rounded-xl px-4 py-2.5 text-center"
          style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.3)" }}
        >
          {fangPayoutLine}
        </div>
      )}

      {/* ── Game-specific extras (awards etc.) ── */}
      {children}

      {/* ── CTAs ── */}
      {isHost ? (
        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <button
            onClick={() => void onPlayAgain()}
            disabled={playAgainPending}
            className="flex-1 py-3.5 rounded-xl font-bebas tracking-wider text-base transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
              color: "#04080F",
              boxShadow: "0 4px 18px rgba(255,215,0,0.3)",
            }}
          >
            {playAgainPending ? "RESETTING..." : "PLAY AGAIN"}
          </button>
          <button
            onClick={() => void onBackToLobby()}
            className="flex-1 py-3.5 rounded-xl font-bebas tracking-wider text-base transition-all active:scale-95"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(238,244,255,0.85)",
            }}
          >
            BACK TO LOBBY
          </button>
        </div>
      ) : (
        <div className="text-center pt-1">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bebas tracking-wider text-cream/55 bg-white/[0.04] border border-white/10">
            Waiting for the host to pick what's next
          </span>
        </div>
      )}
    </motion.div>
  );
}
