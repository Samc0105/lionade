/**
 * shop-daily-drops — deterministic-by-UTC-date drop rotation.
 *
 * Same day = same drops for every user globally. Refresh happens naturally
 * when the user loads after midnight UTC. No server tick, no per-user state.
 *
 * Why deterministic-by-date instead of per-user random?
 *   - Shop "feels alive" without per-user complexity
 *   - Social signal: two users open shop together and see the same drops,
 *     can compare/discuss
 *   - Pure function: easy to test, easy for iOS to mirror with identical
 *     output for any given (date, catalog) input
 *
 * Algorithm:
 *   1. Seed from today's UTC date (YYYY-MM-DD → integer)
 *   2. Filter pool to drop-eligible SKUs (priced, non-founder, non-earned)
 *   3. Dedupe by SKU id (catalogs like FEATURED_ITEMS re-list existing SKUs,
 *      so a concatenated pool can carry the same id twice; duplicate ids hash
 *      to the same sort key, land adjacent, and would both make the slice)
 *   4. Stable shuffle by hash(seed + sku.id)
 *   5. Slice first N
 */

import type { ShopItem } from "@lionade/core/constants/shop-catalog";

const DEFAULT_DROP_COUNT = 5;

/**
 * Cheap deterministic 32-bit hash. Same string in → same number out.
 * Used to give each SKU a stable per-day sort key.
 */
function hash(input: string | number): number {
  const str = String(input);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return h >>> 0;
}

/**
 * Format a Date as a YYYY-MM-DD integer in UTC, so every client picks the
 * same drop set regardless of local timezone.
 */
export function utcDateSeed(date: Date = new Date()): number {
  return Number(date.toISOString().slice(0, 10).replace(/-/g, ""));
}

/**
 * Returns true if the SKU is eligible to appear in the daily drop pool.
 * Excludes:
 *   - Anything without a Fang price (cash-only items aren't "drops")
 *   - Founder badges (capped supply, surfaced in the Limited Time strip)
 *   - Earned cosmetics (never purchasable)
 */
export function isDropEligible(sku: ShopItem): boolean {
  if (!sku.price || sku.price <= 0) return false;
  if (sku.id.startsWith("badge_")) return false;
  if (sku.id.startsWith("emblem_")) return false;
  if (sku.id.startsWith("medal_")) return false;
  if (sku.type === "founder_badge") return false;
  if (sku.type === "earned_medal") return false;
  if (sku.type === "profile_flair") return false;
  return true;
}

/**
 * Pick today's drops from the given catalog. Deterministic per UTC date.
 *
 * @param allSkus  Combined catalog (cosmetics + boosters + auras + voice + username effects + animated banners)
 * @param date     Defaults to now()
 * @param count    Number of drops to return (default 5)
 */
export function todaysDrops(
  allSkus: ShopItem[],
  date: Date = new Date(),
  count: number = DEFAULT_DROP_COUNT,
): ShopItem[] {
  const seed = utcDateSeed(date);
  const eligible = allSkus.filter(isDropEligible);
  // Dedupe by id, first occurrence wins. Duplicate ids share an identical
  // hash key, so without this a twice-listed SKU can occupy two drop slots
  // (seen live 2026-07-06: name_aurora rendered twice in Today's Drops).
  const seen = new Set<string>();
  const pool = eligible.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  // Stable shuffle: assign each SKU a (seed + id) hash, then sort by it.
  const keyed = pool.map((s) => ({ s, key: hash(`${seed}|${s.id}`) }));
  keyed.sort((a, b) => a.key - b.key);
  return keyed.slice(0, count).map((k) => k.s);
}
