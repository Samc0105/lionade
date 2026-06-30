"use client";

import { getBadgeStyle } from "@/lib/cosmetics/badge-styles";

/**
 * EquippedFlair — a small rarity-tinted pill showing an owned founder badge /
 * flair next to the username. V1 auto-shows the highest-rarity owned founder
 * badge (passed as `flair` from useEquippedCosmetics). Renders nothing when the
 * user has no flair, so it's a safe drop-in next to AnimatedUsername.
 */
export default function EquippedFlair({
  flair,
  compact = false,
}: {
  flair: string | null | undefined;
  /** Icon-only pill (no label) — for narrow surfaces like social rows. */
  compact?: boolean;
}) {
  const style = getBadgeStyle(flair);
  if (!style) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold align-middle shrink-0 ${
        compact ? "gap-0 px-1.5 py-0.5 text-[11px]" : "gap-1.5 px-3 py-1 text-xs"
      }`}
      style={{
        background: `${style.tint}1a`,
        borderColor: `${style.tint}59`,
        color: style.tint,
      }}
      title={`${style.label} · ${style.rarity}`}
      aria-label={compact ? `${style.label} founder badge` : undefined}
    >
      <span aria-hidden="true">{style.icon}</span>
      {!compact && <span className="truncate max-w-[150px]">{style.label}</span>}
    </span>
  );
}
