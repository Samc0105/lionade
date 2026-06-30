/**
 * Premium USD items — canonical server-side mapping of premium item id →
 * grant info + Stripe Price ID env var. Mirrors lib/fang-packs.ts. Shared by
 * the USD checkout route (app/api/stripe/usd-purchase) and the webhook handler
 * so both agree on what to grant. The webhook resolves the item TYPE here and
 * NEVER trusts client-supplied price/type — the real charge is the Stripe Price
 * object; this catalog only decides what is granted on fulfillment.
 *
 * FAIL-CLOSED BY DESIGN: until Sam creates a Stripe Price and pastes its id
 * into the matching `STRIPE_PRICE_ID_*` env var, getPremiumPriceId returns null,
 * the checkout route returns "not yet available", and the UI keeps the item's
 * buy button disabled. So this whole slice ships dormant.
 *
 * The id set is the union of every premium id the shop UI renders for USD
 * purchase: the premium-tab cosmetics (PREMIUM_ITEMS), the cash banner grid
 * (CASH_PREMIUM_BANNERS), and the $14.99 Founding Scholar founder bundle.
 */

export type PremiumGrantKind = "cosmetic" | "founder_badge";

export interface PremiumUsdItem {
  id: string;
  /** ItemType for the user_inventory insert (cosmetics only). */
  type: string;
  /** Rarity for the user_inventory insert (cosmetics only). */
  rarity: string;
  /** Display/sanity price; the real charge is the Stripe Price object. */
  priceUSD: number;
  /** STRIPE_PRICE_ID_* env var name holding the live one-time Price id. */
  priceEnv: string;
  grantKind: PremiumGrantKind;
  /** Founder-badge cap (founder_badge grantKind only). */
  cap?: number;
}

export const PREMIUM_USD_ITEMS: Record<string, PremiumUsdItem> = {
  // ── Premium-tab cosmetics (app/shop PREMIUM_ITEMS) ──
  prem_frame_diamond:    { id: "prem_frame_diamond",    type: "frame",      rarity: "legendary", priceUSD: 4.99, priceEnv: "STRIPE_PRICE_ID_PREM_FRAME_DIAMOND",    grantKind: "cosmetic" },
  prem_frame_neon:       { id: "prem_frame_neon",       type: "frame",      rarity: "epic",      priceUSD: 2.99, priceEnv: "STRIPE_PRICE_ID_PREM_FRAME_NEON",       grantKind: "cosmetic" },
  prem_name_holo:        { id: "prem_name_holo",        type: "name_color", rarity: "legendary", priceUSD: 1.99, priceEnv: "STRIPE_PRICE_ID_PREM_NAME_HOLO",        grantKind: "cosmetic" },
  prem_name_gold:        { id: "prem_name_gold",        type: "name_color", rarity: "epic",      priceUSD: 1.49, priceEnv: "STRIPE_PRICE_ID_PREM_NAME_GOLD",        grantKind: "cosmetic" },
  prem_banner_phoenix:   { id: "prem_banner_phoenix",   type: "banner",     rarity: "legendary", priceUSD: 4.99, priceEnv: "STRIPE_PRICE_ID_PREM_BANNER_PHOENIX",   grantKind: "cosmetic" },
  prem_banner_void:      { id: "prem_banner_void",      type: "banner",     rarity: "epic",      priceUSD: 3.49, priceEnv: "STRIPE_PRICE_ID_PREM_BANNER_VOID",      grantKind: "cosmetic" },
  prem_frame_starfield:  { id: "prem_frame_starfield",  type: "frame",      rarity: "rare",      priceUSD: 1.99, priceEnv: "STRIPE_PRICE_ID_PREM_FRAME_STARFIELD",  grantKind: "cosmetic" },
  prem_banner_lightning: { id: "prem_banner_lightning", type: "banner",     rarity: "rare",      priceUSD: 2.49, priceEnv: "STRIPE_PRICE_ID_PREM_BANNER_LIGHTNING", grantKind: "cosmetic" },
  prem_name_fire:        { id: "prem_name_fire",        type: "name_color", rarity: "rare",      priceUSD: 0.99, priceEnv: "STRIPE_PRICE_ID_PREM_NAME_FIRE",        grantKind: "cosmetic" },

  // ── Cash banner grid (app/shop CASH_PREMIUM_BANNERS) ──
  prem_banner_eclipse:   { id: "prem_banner_eclipse",   type: "banner",     rarity: "legendary", priceUSD: 5.99, priceEnv: "STRIPE_PRICE_ID_PREM_BANNER_ECLIPSE",   grantKind: "cosmetic" },
  prem_banner_aurora_x:  { id: "prem_banner_aurora_x",  type: "banner",     rarity: "legendary", priceUSD: 4.99, priceEnv: "STRIPE_PRICE_ID_PREM_BANNER_AURORA_X",  grantKind: "cosmetic" },
  prem_banner_nebula:    { id: "prem_banner_nebula",    type: "banner",     rarity: "epic",      priceUSD: 3.99, priceEnv: "STRIPE_PRICE_ID_PREM_BANNER_NEBULA",    grantKind: "cosmetic" },
  prem_banner_chromium:  { id: "prem_banner_chromium",  type: "banner",     rarity: "epic",      priceUSD: 3.49, priceEnv: "STRIPE_PRICE_ID_PREM_BANNER_CHROMIUM",  grantKind: "cosmetic" },

  // ── Founder bundle (also free for the first 1,000 Pro subscribers) ──
  badge_founding_scholar: { id: "badge_founding_scholar", type: "founder_badge", rarity: "legendary", priceUSD: 14.99, priceEnv: "STRIPE_PRICE_ID_BADGE_FOUNDING_SCHOLAR", grantKind: "founder_badge", cap: 1000 },
};

export function isPremiumItemId(v: unknown): v is string {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PREMIUM_USD_ITEMS, v);
}

export function getPremiumItem(id: string): PremiumUsdItem | null {
  return PREMIUM_USD_ITEMS[id] ?? null;
}

/** Resolve the live Stripe Price id from env, or null if unset (fail-closed). */
export function getPremiumPriceId(id: string): string | null {
  const item = PREMIUM_USD_ITEMS[id];
  if (!item) return null;
  const env = process.env[item.priceEnv];
  return env && env.length > 0 ? env : null;
}

/**
 * Premium ids that currently have a configured Stripe Price (server-only —
 * reads process.env). The shop GETs this so it only enables Buy buttons for
 * items that can actually be checked out; everything else stays "Coming soon".
 */
export function getPurchasablePremiumIds(): string[] {
  return Object.keys(PREMIUM_USD_ITEMS).filter((id) => getPremiumPriceId(id) !== null);
}
