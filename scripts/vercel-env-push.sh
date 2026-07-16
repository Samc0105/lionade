#!/bin/bash
# Pushes all Stripe price IDs + live keys to Vercel production env.
# Run: bash scripts/vercel-env-push.sh
# Requires: vercel CLI logged in, and the three live keys set below.

set -e

# Reads live keys from .env.local (gitignored) — never hardcode secrets here.
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$SCRIPT_DIR/.env.local" ]; then
  set -a; source "$SCRIPT_DIR/.env.local"; set +a
fi

STRIPE_PUBLISHABLE_KEY="${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:?NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY not set in .env.local}"
STRIPE_SECRET="${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY not set in .env.local}"
STRIPE_WEBHOOK="${STRIPE_WEBHOOK_SECRET:?STRIPE_WEBHOOK_SECRET not set in .env.local}"

ENV=production

add() {
  local key=$1
  local val=$2
  # printf '%s' — NOT echo — echo appends \n which Vercel stores verbatim,
  # corrupting the value (a sk_live_...\n Authorization header makes every
  # Stripe SDK call throw StripeConnectionError).
  printf '%s' "$val" | vercel env add "$key" "$ENV" --force 2>/dev/null && echo "  ✓ $key" || echo "  ✗ $key (failed)"
}

echo "Pushing Stripe env vars to Vercel ($ENV)..."

add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY "$STRIPE_PUBLISHABLE_KEY"
add STRIPE_SECRET_KEY                  "$STRIPE_SECRET"
add STRIPE_WEBHOOK_SECRET              "$STRIPE_WEBHOOK"

add STRIPE_PRICE_ID_PRO_MONTHLY        "price_1Ttbk9RUELyH1cDjv91hVuzM"
add STRIPE_PRICE_ID_PRO_ANNUAL         "price_1TtbkARUELyH1cDjx4Sps6h2"
add STRIPE_PRICE_ID_PLATINUM_MONTHLY   "price_1TtbkARUELyH1cDjLRjESWQO"
add STRIPE_PRICE_ID_PLATINUM_ANNUAL    "price_1TtbkARUELyH1cDjsjN115nJ"
add STRIPE_PRICE_ID_FANGS_S            "price_1TtbkBRUELyH1cDjAyRGiMgS"
add STRIPE_PRICE_ID_FANGS_M            "price_1TtbkBRUELyH1cDj5OB4tNUP"
add STRIPE_PRICE_ID_FANGS_L            "price_1TtbkCRUELyH1cDjKMAX4Tzh"
add STRIPE_PRICE_ID_FANGS_XL           "price_1TtbkCRUELyH1cDjdzlKp0ln"
add STRIPE_PRICE_ID_PREM_FRAME_DIAMOND    "price_1TtbkDRUELyH1cDjnOE8oI4y"
add STRIPE_PRICE_ID_PREM_FRAME_NEON       "price_1TtbkDRUELyH1cDjRG6RdBZH"
add STRIPE_PRICE_ID_PREM_FRAME_STARFIELD  "price_1TtbkDRUELyH1cDjp4l9yu6N"
add STRIPE_PRICE_ID_PREM_NAME_HOLO        "price_1TtbkERUELyH1cDjHfQJs6Y1"
add STRIPE_PRICE_ID_PREM_NAME_GOLD        "price_1TtbkERUELyH1cDj3gAB9eaI"
add STRIPE_PRICE_ID_PREM_NAME_FIRE        "price_1TtbkFRUELyH1cDjdJGcXodI"
add STRIPE_PRICE_ID_PREM_BANNER_ECLIPSE   "price_1TtbkFRUELyH1cDj3Q17Yib1"
add STRIPE_PRICE_ID_PREM_BANNER_AURORA_X  "price_1TtbkGRUELyH1cDjAxItbVi8"
add STRIPE_PRICE_ID_PREM_BANNER_PHOENIX   "price_1TtbkGRUELyH1cDjzoSEEPYk"
add STRIPE_PRICE_ID_PREM_BANNER_NEBULA    "price_1TtbkGRUELyH1cDjm5EH2tmZ"
add STRIPE_PRICE_ID_PREM_BANNER_VOID      "price_1TtbkHRUELyH1cDjjlkHUrE0"
add STRIPE_PRICE_ID_PREM_BANNER_CHROMIUM  "price_1TtbkIRUELyH1cDjt4LgMPIv"
add STRIPE_PRICE_ID_PREM_BANNER_LIGHTNING "price_1TtbkIRUELyH1cDjqXWPunng"
add STRIPE_PRICE_ID_BADGE_FOUNDING_SCHOLAR "price_1TtbkJRUELyH1cDjR2TrJhOy"

echo ""
echo "Done. Now redeploy: vercel deploy --prod"
