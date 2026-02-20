"use client";

import { Badge } from "@/types";
import { getRarityColor } from "@/lib/utils";

interface BadgeCardProps {
  badge: Badge;
  size?: "sm" | "md" | "lg";
  earned?: boolean;
}

export default function BadgeCard({ badge, size = "md", earned = true }: BadgeCardProps) {
  const rarityColor = getRarityColor(badge.rarity);

  const sizeClasses = {
    sm: { icon: "text-2xl", card: "p-3", name: "text-xs", desc: "hidden" },
    md: { icon: "text-4xl", card: "p-4", name: "text-sm", desc: "text-xs" },
    lg: { icon: "text-5xl", card: "p-6", name: "text-base", desc: "text-sm" },
  };

  const classes = sizeClasses[size];

  const rarityLabel = badge.rarity.charAt(0).toUpperCase() + badge.rarity.slice(1);

  return (
    <div
      className={`relative rounded-xl border transition-all duration-300 hover:-translate-y-1
        hover:shadow-lg ${classes.card} ${earned ? "cursor-pointer" : "opacity-40 grayscale"}`}
      style={{
        borderColor: earned ? `${rarityColor}60` : "#4A90D920",
        background: earned
          ? `linear-gradient(135deg, ${rarityColor}10 0%, #060c18 100%)`
          : "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
        boxShadow: earned ? `0 4px 20px ${rarityColor}20` : "none",
      }}
    >
      {/* Rarity indicator */}
      {earned && (
        <div
          className="absolute top-2 right-2 w-2 h-2 rounded-full"
          style={{ background: rarityColor, boxShadow: `0 0 6px ${rarityColor}` }}
        />
      )}

      {/* Icon */}
      <div className={`${classes.icon} mb-2 ${earned ? "" : "grayscale"}`}>
        {badge.icon}
      </div>

      {/* Name */}
      <p className={`${classes.name} font-bold text-cream mb-1 leading-tight`}>
        {badge.name}
      </p>

      {/* Rarity */}
      <p
        className="text-xs font-semibold uppercase tracking-widest mb-1"
        style={{ color: rarityColor }}
      >
        {rarityLabel}
      </p>

      {/* Description */}
      {size !== "sm" && (
        <p className={`${classes.desc} text-cream/50 leading-snug`}>
          {badge.description}
        </p>
      )}

      {/* Earned date */}
      {earned && badge.earnedAt && size === "lg" && (
        <p className="text-xs text-cream/30 mt-2">
          Earned {new Date(badge.earnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
      )}

      {/* Lock overlay */}
      {!earned && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl">
          <span className="text-2xl">🔒</span>
        </div>
      )}
    </div>
  );
}
