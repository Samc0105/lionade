/**
 * Fang IAP packs — canonical server-side mapping of pack id → Fang grant +
 * cents price + Stripe Price ID env var. Shared by the checkout route
 * (`app/api/stripe/fang-purchase`) and the webhook handler so both agree on
 * the amount to credit. The webhook re-validates `metadata.fang_amount`
 * against this table — never trusts the metadata blindly.
 *
 * p_source='iap' on credit → Apple 3.1.5(b) compliance, IAP Fangs cannot be
 * cashable in V2.
 */

export type FangPackId = "fangs_s" | "fangs_m" | "fangs_l" | "fangs_xl";

export interface FangPack {
  fangs: number;
  price_cents: number;
  price_id_env: string;
  display_name: string;
}

export const FANG_PACKS: Record<FangPackId, FangPack> = {
  fangs_s:  { fangs: 5000,   price_cents: 99,   price_id_env: "STRIPE_PRICE_ID_FANGS_S",  display_name: "Small Fang Pouch" },
  fangs_m:  { fangs: 30000,  price_cents: 499,  price_id_env: "STRIPE_PRICE_ID_FANGS_M",  display_name: "Medium Fang Sack" },
  fangs_l:  { fangs: 140000, price_cents: 1999, price_id_env: "STRIPE_PRICE_ID_FANGS_L",  display_name: "Large Fang Chest" },
  fangs_xl: { fangs: 400000, price_cents: 4999, price_id_env: "STRIPE_PRICE_ID_FANGS_XL", display_name: "Whale Fang Vault" },
};

export function isFangPackId(v: unknown): v is FangPackId {
  return v === "fangs_s" || v === "fangs_m" || v === "fangs_l" || v === "fangs_xl";
}

export function fangPackPriceId(packId: FangPackId): string | null {
  const env = process.env[FANG_PACKS[packId].price_id_env];
  return env && env.length > 0 ? env : null;
}
