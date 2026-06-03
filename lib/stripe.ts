// Server-only Stripe SDK init + price-id ↔ tier mapping.
// Never import in client components. The secret key bypasses every guard.

import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey && process.env.NODE_ENV === "production") {
  // Loud at boot so a missing env var on Vercel fails the deploy log.
  console.error("[stripe] STRIPE_SECRET_KEY is not set");
}

export const stripe = new Stripe(secretKey ?? "", {
  apiVersion: "2026-02-25.clover",
  typescript: true,
  // 15s per-request timeout enforced by the SDK; 2 network retries on top.
  timeout: 15_000,
  maxNetworkRetries: 2,
});

export type Tier = "pro" | "platinum";
export type Cycle = "monthly" | "annual";

export interface PriceLookup {
  priceId: string;
  tier: Tier;
  cycle: Cycle;
}

function envPrice(name: string): string | null {
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}

/** Resolve env-configured price id for a (tier, cycle). Returns null when unset. */
export function priceIdFor(tier: Tier, cycle: Cycle): string | null {
  if (tier === "pro" && cycle === "monthly") return envPrice("STRIPE_PRICE_ID_PRO_MONTHLY");
  if (tier === "pro" && cycle === "annual") return envPrice("STRIPE_PRICE_ID_PRO_ANNUAL");
  if (tier === "platinum" && cycle === "monthly") return envPrice("STRIPE_PRICE_ID_PLATINUM_MONTHLY");
  if (tier === "platinum" && cycle === "annual") return envPrice("STRIPE_PRICE_ID_PLATINUM_ANNUAL");
  return null;
}

/** Reverse lookup for the webhook: Stripe price id → tier+cycle. */
export function lookupPrice(priceId: string | null | undefined): PriceLookup | null {
  if (!priceId) return null;
  const table: Array<[string, Tier, Cycle]> = [
    ["STRIPE_PRICE_ID_PRO_MONTHLY", "pro", "monthly"],
    ["STRIPE_PRICE_ID_PRO_ANNUAL", "pro", "annual"],
    ["STRIPE_PRICE_ID_PLATINUM_MONTHLY", "platinum", "monthly"],
    ["STRIPE_PRICE_ID_PLATINUM_ANNUAL", "platinum", "annual"],
  ];
  for (const [envName, tier, cycle] of table) {
    if (envPrice(envName) === priceId) return { priceId, tier, cycle };
  }
  return null;
}
