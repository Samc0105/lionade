"use client";

// Shared scoreboard component for Lionade Party games.
// Renders a compact grid of players + scores, sorted descending.
// Pure presentation; the parent owns the data shape.
//
// JUICE: scores COUNT UP (reusing the reduced-motion-aware CountUp), rank
// changes animate via framer `layout` (rows slide to their new position when
// the sort order shifts), and the leader (#1) gets a subtle gold glow breathe.
// All driven by the `players` already in client state — nothing is re-fetched.

import { motion, useReducedMotion } from "framer-motion";
import { Crown, Eye } from "@phosphor-icons/react";
import CountUp from "@/components/CountUp";
import AnimatedUsername from "@/components/AnimatedUsername";
import { resolveRowUsernameEffect, resolveRowNameColor } from "@/lib/use-username-effect";

interface Player {
  user_id: string;
  username: string | null;
  score: number;
  // Shop V2 — server-supplied equipped cosmetics (optional).
  equipped_username_effect?: string | null;
  equipped_name_color?: string | null;
}

interface Props {
  players: Player[];
  highlightUserId?: string | null;
  drawerUserId?: string | null;
  compact?: boolean;
  // Phase 2 spectator mode — user ids in this set get a small "spectating"
  // badge next to their row so the room sees who joined mid-round.
  spectatorUserIds?: Set<string>;
  // Round-flow V2 (additive, default off) — rows slide up with a small
  // per-row stagger on MOUNT. Used by reveal sequences (Sketchy) where the
  // scoreboard is a staged beat. Re-sorting still animates via `layout`
  // independently of this flag. No-op under reduced motion.
  staggerIn?: boolean;
}

export default function PartyScoreboard({
  players,
  highlightUserId,
  drawerUserId,
  compact = false,
  spectatorUserIds,
  staggerIn = false,
}: Props) {
  const reduced = useReducedMotion();
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <div
      className={`rounded-2xl ${compact ? "p-3" : "p-5"}`}
      style={{
        background: "linear-gradient(135deg, rgba(16,12,26,0.7) 0%, rgba(8,6,16,0.7) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px)",
      }}
    >
      <p className={`font-bebas tracking-[0.25em] text-cream/50 mb-3 ${compact ? "text-[10px]" : "text-xs"}`}>
        SCOREBOARD
      </p>
      <div className="space-y-1.5">
        {sorted.map((p, i) => {
          const isMe = p.user_id === highlightUserId;
          const isDrawer = p.user_id === drawerUserId;
          const isLeader = i === 0 && p.score > 0;
          return (
            <motion.div
              key={p.user_id}
              layout={reduced ? false : "position"}
              initial={staggerIn && !reduced ? { opacity: 0, y: 6 } : false}
              animate={staggerIn && !reduced ? { opacity: 1, y: 0 } : undefined}
              transition={
                reduced
                  ? { duration: 0 }
                  : {
                      // Per-property: the layout spring handles re-sorts; the
                      // mount stagger only drives opacity/y so a later rank
                      // change is never delayed by the row's entry delay.
                      layout: { type: "spring", stiffness: 380, damping: 30 },
                      opacity: { duration: 0.3, delay: staggerIn ? i * 0.06 : 0, ease: [0.16, 1, 0.3, 1] },
                      y: { duration: 0.3, delay: staggerIn ? i * 0.06 : 0, ease: [0.16, 1, 0.3, 1] },
                    }
              }
              className={`flex items-center justify-between rounded-lg px-3 py-1.5 ${isLeader && !reduced ? "pa-leader-glow" : ""}`}
              style={{
                background: isMe ? "rgba(168,85,247,0.12)" : "rgba(255,255,255,0.02)",
                border: isMe ? "1px solid rgba(168,85,247,0.35)" : "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="font-bebas text-xs tracking-wider w-5 text-center inline-flex items-center justify-center"
                  style={{ color: i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "rgba(238,244,255,0.4)" }}
                >
                  {isLeader ? <Crown size={13} weight="fill" aria-hidden="true" /> : i + 1}
                </span>
                <span className="font-syne text-sm text-cream/85 truncate">
                  <AnimatedUsername
                    username={p.username ?? "Player"}
                    effect={resolveRowUsernameEffect(p.equipped_username_effect)}
                    nameColor={resolveRowNameColor(p.equipped_name_color)}
                    size="sm"
                  />
                  {isMe && <span className="text-cream/40 text-xs"> (you)</span>}
                </span>
                {isDrawer && (
                  <span className="font-bebas text-[9px] tracking-wider px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-200 border border-purple-500/40">
                    DRAWING
                  </span>
                )}
                {spectatorUserIds?.has(p.user_id) && !isDrawer && (
                  <span
                    className="font-bebas text-[9px] tracking-wider px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5"
                    style={{
                      background: "rgba(168,85,247,0.15)",
                      color: "#E9D5FF",
                      border: "1px solid rgba(168,85,247,0.35)",
                    }}
                    title="Joined mid-round, will play next round"
                  >
                    <Eye size={11} weight="fill" aria-hidden="true" />SPECTATING
                  </span>
                )}
              </div>
              <span className="font-bebas text-lg text-[#FFD700] tracking-wider">
                <CountUp value={p.score} duration={600} />
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
