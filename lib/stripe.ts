// Server-only Stripe SDK init + price-id ↔ tier mapping.
// Never import in client components. The secret key bypasses every guard.

import Stripe from "stripe";

// Lazy-init proxy: the Stripe SDK constructor throws on empty key, and
// Next.js's build-time page-data-collection imports route files (which
// import this module). If STRIPE_SECRET_KEY isn't set at build time
// (Vercel before env vars are wired), `new Stripe("")` crashes the build.
// Defer construction to first runtime access; routes that need it will
// throw at request time instead, leaving the rest of the build intact.
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  _stripe = new Stripe(secretKey, {
    apiVersion: "2026-02-25.clover",
    // Use fetch instead of Node's http agent (which defaults keepAlive:true).
    // Vercel warm Lambda containers reuse this singleton, but Stripe closes
    // idle keep-alive sockets — causing ECONNRESET on the next invocation.
    // Fetch has no persistent pool, so every call gets a fresh connection.
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 15_000,
    maxNetworkRetries: 2,
  });
  return _stripe;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const inst = getStripe();
    const value = (inst as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as Function).bind(inst) : value;
  },
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
