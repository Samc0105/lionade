"use client";

import { getBadgeStyle } from "@/lib/cosmetics/badge-styles";

/**
 * EquippedFlair — a small rarity-tinted pill showing an owned founder badge /
 * flair next to the username. V1 auto-shows the highest-rarity owned founder
 * badge (passed as `flair` from useEquippedCosmetics). Renders nothing when the
 * user has no flair, so it's a safe drop-in next to AnimatedUsername.
 */
export default function EquippedFlair({ flair }: { flair: string | null | undefined }) {
  const style = getBadgeStyle(flair);
  if (!style) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold align-middle"
      style={{
        background: `${style.tint}1a`,
        borderColor: `${style.tint}59`,
        color: style.tint,
      }}
      title={`${style.label} · ${style.rarity}`}
    >
      <span aria-hidden="true">{style.icon}</span>
      <span className="truncate max-w-[150px]">{style.label}</span>
    </span>
  );
}
