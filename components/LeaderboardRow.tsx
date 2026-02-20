"use client";

import { LeaderboardEntry } from "@/types";
import { formatCoins } from "@/lib/mockData";

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  isCurrentUser?: boolean;
  animationDelay?: number;
}

export default function LeaderboardRow({
  entry,
  isCurrentUser = false,
  animationDelay = 0,
}: LeaderboardRowProps) {
  const rankColors: Record<number, string> = {
    1: "text-gold",
    2: "text-gray-300",
    3: "text-amber-600",
  };

  const rankBg: Record<number, string> = {
    1: "bg-gold/10 border-gold/40",
    2: "bg-gray-400/10 border-gray-400/30",
    3: "bg-amber-600/10 border-amber-600/30",
  };

  const rankEmoji: Record<number, string> = {
    1: "👑",
    2: "🥈",
    3: "🥉",
  };

  const changeColor =
    entry.change === "up"
      ? "text-green-400"
      : entry.change === "down"
      ? "text-red-400"
      : "text-cream/40";

  const changeIcon =
    entry.change === "up" ? "▲" : entry.change === "down" ? "▼" : "—";

  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-300
        hover:-translate-y-0.5 group animate-slide-up
        ${isCurrentUser
          ? "border-electric/50 bg-electric/10 shadow-lg shadow-electric/10"
          : entry.rank <= 3
          ? `${rankBg[entry.rank]} `
          : "border-electric/10 bg-navy-50 hover:border-electric/30"
        }`}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Rank */}
      <div className="w-10 flex-shrink-0 text-center">
        {entry.rank <= 3 ? (
          <span className="text-xl">{rankEmoji[entry.rank]}</span>
        ) : (
          <span
            className={`font-bebas text-2xl leading-none
              ${isCurrentUser ? "text-electric" : "text-cream/50"}`}
          >
            {entry.rank}
          </span>
        )}
      </div>

      {/* Avatar */}
      <div className={`w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border-2
        ${isCurrentUser
          ? "border-electric"
          : entry.rank <= 3
          ? rankColors[entry.rank].replace("text-", "border-")
          : "border-electric/20"
        }`}>
        <img
          src={entry.user.avatar}
          alt={entry.user.username}
          className="w-full h-full object-cover bg-navy-50"
        />
      </div>

      {/* User Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`font-bold text-sm truncate
              ${isCurrentUser ? "text-electric" : "text-cream"}`}
          >
            {entry.user.username}
          </span>
          {isCurrentUser && (
            <span className="text-xs bg-electric/20 text-electric px-2 py-0.5 rounded-full border border-electric/30">
              You
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-cream/40">Lvl {entry.user.level}</span>
          <span className="text-xs text-orange-400">🔥 {entry.streak}</span>
        </div>
      </div>

      {/* Badges Preview */}
      <div className="hidden sm:flex items-center gap-0.5">
        {entry.user.badges.slice(0, 3).map((badge) => (
          <span key={badge.id} className="text-base" title={badge.name}>
            {badge.icon}
          </span>
        ))}
      </div>

      {/* Coins This Week */}
      <div className="text-right flex-shrink-0">
        <div className="flex items-center gap-1.5 justify-end">
          <span className="text-sm">🪙</span>
          <span
            className={`font-bebas text-xl leading-none
              ${entry.rank === 1 ? "text-gold glow-gold" : "text-cream"}`}
          >
            {formatCoins(entry.coinsThisWeek)}
          </span>
        </div>
        <div className={`text-xs font-semibold mt-0.5 ${changeColor}`}>
          {changeIcon}
          {entry.changeAmount ? ` ${entry.changeAmount}` : ""}
        </div>
      </div>
    </div>
  );
}
