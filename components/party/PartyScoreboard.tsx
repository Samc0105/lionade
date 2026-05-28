"use client";

// Shared scoreboard component for Lionade Party games.
// Renders a compact grid of players + scores, sorted descending.
// Pure presentation; the parent owns the data shape.

interface Player {
  user_id: string;
  username: string | null;
  score: number;
}

interface Props {
  players: Player[];
  highlightUserId?: string | null;
  drawerUserId?: string | null;
  compact?: boolean;
}

export default function PartyScoreboard({
  players,
  highlightUserId,
  drawerUserId,
  compact = false,
}: Props) {
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
          return (
            <div
              key={p.user_id}
              className="flex items-center justify-between rounded-lg px-3 py-1.5"
              style={{
                background: isMe ? "rgba(168,85,247,0.12)" : "rgba(255,255,255,0.02)",
                border: isMe ? "1px solid rgba(168,85,247,0.35)" : "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="font-bebas text-xs tracking-wider w-5 text-center"
                  style={{ color: i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "rgba(238,244,255,0.4)" }}
                >
                  {i + 1}
                </span>
                <span className="font-syne text-sm text-cream/85 truncate">
                  {p.username ?? "Player"}
                  {isMe && <span className="text-cream/40 text-xs"> (you)</span>}
                </span>
                {isDrawer && (
                  <span className="font-bebas text-[9px] tracking-wider px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-200 border border-purple-500/40">
                    DRAWING
                  </span>
                )}
              </div>
              <span className="font-bebas text-lg text-[#FFD700] tracking-wider">
                {p.score.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
