"use client";

// Cross-game intermission card.
// Renders in place of the bare loading screen between rounds so the wait beat
// reads as "stretch your legs, here's the scoreboard" instead of "API call."
// Each game's loading branch swaps to this when at least one player has score
// > 0 (i.e. we've completed at least one prior round). Same component, three
// accent flavors.

import { useReducedMotion } from "framer-motion";

interface Player {
  user_id: string;
  username: string | null;
  score: number;
}

interface Props {
  /** Players in the room. Will be sorted by score desc and capped to top 5. */
  players: Player[];
  /** "1f5d4d…" / whichever id should glow as "you" in the scoreboard. */
  meUserId: string;
  /** Tier-color accent for the surrounding glow + spinner ring. */
  accent: string;
  /** Headline copy beneath the spinner — e.g. "ROUND 2 IS NEXT" or
   *  "FRESH MATCH STARTING". */
  headline: string;
  /** Optional italic sub-line. */
  sub?: string;
}

export default function IntermissionCard({
  players,
  meUserId,
  accent,
  headline,
  sub,
}: Props) {
  const reduced = useReducedMotion();
  const top = [...players]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5);

  return (
    <div className="flex flex-col items-center py-12 gap-5 relative">
      {/* Twin radial glows — matches the loading-screen treatment so the
          transition between bare-loading and intermission is consistent. */}
      <div className="relative w-24 h-24 flex items-center justify-center">
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
          style={{
            background: `radial-gradient(circle, ${accent}73 0%, transparent 70%)`,
          }}
        />
        <span
          aria-hidden="true"
          className={`absolute inset-2 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
          style={{
            background: "radial-gradient(circle, rgba(168,85,247,0.35) 0%, transparent 70%)",
            animationDelay: "0.6s",
          }}
        />
        <div
          className="w-10 h-10 rounded-full border-2 animate-spin relative z-10"
          style={{ borderColor: `${accent}40`, borderTopColor: accent }}
        />
      </div>
      <p className="font-bebas text-xs tracking-[0.35em] text-cream/45">INTERMISSION</p>
      <p className="font-bebas text-2xl text-cream/85 tracking-[0.25em]">{headline}</p>
      {sub && <p className="text-cream/45 text-xs font-syne italic">{sub}</p>}

      {/* Running top-5 scoreboard. Compact rows so the card stays a beat,
          not a feature. Crown on rank 1 if there's a meaningful leader. */}
      {top.length > 0 && top.some(p => (p.score ?? 0) > 0) && (
        <div
          className="w-full max-w-sm rounded-2xl p-4 space-y-1.5 mt-2"
          style={{
            background: "linear-gradient(135deg, rgba(16,12,26,0.7) 0%, rgba(8,6,16,0.7) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(8px)",
          }}
        >
          <p className="font-bebas text-[10px] tracking-[0.3em] text-cream/45 mb-2">SCOREBOARD</p>
          {top.map((p, i) => {
            const isMe = p.user_id === meUserId;
            const isLeader = i === 0 && (p.score ?? 0) > 0;
            return (
              <div
                key={p.user_id}
                className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg"
                style={{
                  background: isMe ? `${accent}1a` : "transparent",
                  border: isMe ? `1px solid ${accent}55` : "1px solid transparent",
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="font-bebas text-[11px] w-5 text-center"
                    style={{ color: isLeader ? "#FFD700" : "rgba(238,244,255,0.45)" }}
                  >
                    {isLeader ? "👑" : `#${i + 1}`}
                  </span>
                  <span className="font-syne text-sm text-cream/90 truncate">
                    {p.username ?? "Player"}
                    {isMe && <span className="text-cream/45 text-[10px] ml-1">you</span>}
                  </span>
                </div>
                <span className="font-bebas text-base text-cream/85 tabular-nums">
                  {p.score ?? 0}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
