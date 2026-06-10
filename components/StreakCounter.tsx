"use client";

import { Fire } from "@phosphor-icons/react";

interface StreakCounterProps {
  streak: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export default function StreakCounter({ streak, size = "md", showLabel = true }: StreakCounterProps) {
  const isHot = streak >= 7;
  const isOnFire = streak >= 14;
  // Zero streak = no fire. A filled orange flame next to "0" is visually
  // contradictory, so the zero state dims to an outline flame + muted count.
  // Same icon size / layout, only weight + color change — no layout shift.
  const isActive = streak > 0;

  const sizeClasses = {
    sm: { fire: "text-xl", number: "text-2xl", label: "text-xs", fireSize: 24 },
    md: { fire: "text-3xl", number: "text-4xl", label: "text-sm", fireSize: 32 },
    lg: { fire: "text-5xl", number: "text-6xl", label: "text-base", fireSize: 52 },
  };

  const classes = sizeClasses[size];

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative flex items-center justify-center">
        {/* Glow effect for high streaks */}
        {isOnFire && (
          <div className="absolute inset-0 rounded-full blur-xl opacity-60"
            style={{ background: "radial-gradient(circle, #FF6B00 0%, transparent 70%)" }}
          />
        )}

        {/* Fire icon */}
        <span
          className={`${classes.fire} ${isHot ? "animate-streak-fire" : ""} relative z-10 inline-flex items-center justify-center`}
        >
          <Fire size={classes.fireSize} weight={isActive ? "fill" : "regular"} color={isActive ? "#FB923C" : "rgba(238, 244, 255, 0.3)"} aria-hidden="true" />
        </span>

        {/* Streak count overlay */}
        {size !== "sm" && (
          <span
            className={`absolute -bottom-1 -right-1 font-bebas ${classes.number}
              ${isOnFire ? "text-orange-400 glow-gold" : isActive ? "text-cream" : "text-cream/30"} leading-none z-20`}
          >
            {streak}
          </span>
        )}
      </div>

      {size === "sm" && (
        <span className={`font-bebas ${classes.number} ${isActive ? "text-orange-400" : "text-cream/30"} leading-none`}>
          {streak}
        </span>
      )}

      {showLabel && (
        <span className={`${classes.label} text-cream/50 font-semibold uppercase tracking-widest`}>
          Quiz Streak
        </span>
      )}
    </div>
  );
}
