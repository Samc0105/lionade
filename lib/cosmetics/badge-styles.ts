// Badge / flair visual resolver (Shop V2).
//
// founder_badge / earned_medal / profile_flair catalog items have no entry in
// cosmetic-styles.ts (which only covers frame/aura/name/banner). This thin
// resolver pulls their display metadata (icon/name/rarity) straight from the
// catalog so a small "flair pill" can render them next to the username — most
// importantly the paid Founding Scholar founder badge, which otherwise renders
// nowhere despite being a $14.99 SKU.

import { getFounderBadge, getEarnedCosmetic } from "@/lib/shop-catalog";

const RARITY_RANK: Record<string, number> = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

const RARITY_TINT: Record<string, string> = {
  common: "#9CA3AF",
  rare: "#4C96E1",
  epic: "#A855F7",
  legendary: "#F0B429",
};

export interface BadgeStyle {
  icon: string;
  label: string;
  rarity: string;
  tint: string;
}

/** Resolve a badge/medal/flair id to its display style, or null if unknown. */
export function getBadgeStyle(id: string | null | undefined): BadgeStyle | null {
  if (!id) return null;
  const meta = getFounderBadge(id) ?? getEarnedCosmetic(id);
  if (!meta) return null;
  const rarity = meta.rarity ?? "rare";
  return {
    icon: meta.icon ?? "\u{1F3C5}", // 🏅
    label: meta.name ?? id,
    rarity,
    tint: RARITY_TINT[rarity] ?? "#9CA3AF",
  };
}

/**
 * Auto-pick the highest-rarity FOUNDER badge id from a set of owned ids, so we
 * can show the most prestigious one without an explicit equip slot (V1).
 * Returns null if none of the ids are founder badges.
 */
export function pickTopFounderBadge(ids: string[]): string | null {
  let best: string | null = null;
  let bestRank = 0;
  for (const id of ids) {
    const fb = getFounderBadge(id);
    if (!fb) continue;
    const rank = RARITY_RANK[fb.rarity ?? "rare"] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = id;
    }
  }
  return best;
}
