# Stripe Subscriptions — Setup Checklist

Status: code shipped 2026-06-02. Production go-live blocked on Sam completing the steps below.

## 1. Vercel env vars (Production + Preview)

| Var | Where to get it | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Dashboard → Developers → API keys → Secret key | Use `sk_live_...` for prod, `sk_test_...` for Preview |
| `STRIPE_WEBHOOK_SECRET` | Dashboard → Developers → Webhooks → click endpoint → Signing secret | One per environment (separate webhook endpoints for live vs test) |
| `STRIPE_PRICE_ID_PRO_MONTHLY` | Dashboard → Products → Pro → Monthly price | Format `price_...` |
| `STRIPE_PRICE_ID_PRO_ANNUAL` | Dashboard → Products → Pro → Annual price | Format `price_...` |
| `STRIPE_PRICE_ID_PLATINUM_MONTHLY` | Dashboard → Products → Platinum → Monthly price | Format `price_...` |
| `STRIPE_PRICE_ID_PLATINUM_ANNUAL` | Dashboard → Products → Platinum → Annual price | Format `price_...` |
| `STRIPE_PRICE_ID_FANGS_S` | Dashboard → Products → Small Fang Pouch → price | One-time price, `price_...` |
| `STRIPE_PRICE_ID_FANGS_M` | Dashboard → Products → Medium Fang Sack → price | One-time price, `price_...` |
| `STRIPE_PRICE_ID_FANGS_L` | Dashboard → Products → Large Fang Chest → price | One-time price, `price_...` |
| `STRIPE_PRICE_ID_FANGS_XL` | Dashboard → Products → Whale Fang Vault → price | One-time price, `price_...` |
| `NEXT_PUBLIC_SITE_URL` | Your production URL (`https://getlionade.com`); Preview uses the preview URL | Already required by the email program; checkout / portal now pin `success_url` / `cancel_url` / `return_url` to this value instead of trusting the request `Origin` header (open-redirect hardening) |

**Total: 11 Stripe env vars** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, 4 subscription price IDs, 4 Fang-pack price IDs) + `NEXT_PUBLIC_SITE_URL`. Until each price ID is set, that product silently 500s at checkout (`priceIdFor` / `fangPackPriceId` return null and the route returns "Plan unavailable" / "Pack unavailable").

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is NOT required for this implementation. We redirect to Stripe-hosted Checkout via `session.url`, so the publishable key only matters if we add Elements / Payment Element in the browser later.

## 2. Stripe Dashboard — one-time configuration

### Products + Prices
Create 2 products, each with 2 recurring prices.

1. **Pro** (`product_pro`)
   - Monthly: `$6.99 USD` recurring monthly
   - Annual: `$69.99 USD` recurring yearly
2. **Platinum** (`product_platinum`)
   - Monthly: `$14.99 USD` recurring monthly
   - Annual: `$149.99 USD` recurring yearly

Copy the 4 `price_...` ids into the env vars above. **Do NOT change prices in code without updating Stripe** — the price IDs are the source of truth at checkout.

### Fang packs (one-time IAP — also fully coded, route `/api/stripe/fang-purchase`, `mode: 'payment'`)
Create 4 products, each with a single **one-time** price (NOT recurring). The Fang amounts live in code (`lib/fang-packs.ts`); only the dollar price + the `price_...` id matter to Stripe. The amounts MUST match the code:

| Product | Price (USD, one-time) | Grants | Env var |
|---|---|---|---|
| Small Fang Pouch | `$0.99` | 5,000 Fangs | `STRIPE_PRICE_ID_FANGS_S` |
| Medium Fang Sack | `$4.99` | 30,000 Fangs | `STRIPE_PRICE_ID_FANGS_M` |
| Large Fang Chest | `$19.99` | 140,000 Fangs | `STRIPE_PRICE_ID_FANGS_L` |
| Whale Fang Vault | `$49.99` | 400,000 Fangs | `STRIPE_PRICE_ID_FANGS_XL` |

The webhook credits Fangs idempotently via `credit_fang_iap` (migration 070) on `checkout.session.completed` for `mode='payment'`. The Shop page (`/shop`) already has the buy UI.

### ⚠️ iOS / App Store — Apple IAP, NOT Stripe (do NOT skip)
Stripe is for the **WEB** only. Apple's App Store rules (3.1.1) require digital goods consumed in the app — both the Pro/Platinum subscription AND the Fang packs — to be sold through **Apple In-App Purchase**, not Stripe, on iOS. Shipping Stripe checkout inside the iOS app (or even linking out to it for digital goods) risks rejection under the anti-steering rules. So: web monetization = Stripe (this doc); iOS monetization = a separate StoreKit / `expo-in-app-purchases` (or RevenueCat) integration with matching product IDs, reconciled to the same `profiles.plan` / Fang ledger server-side. That iOS IAP work is NOT built yet — keep the iOS app's paywall buttons either hidden or routed to Apple IAP before submitting a build that exposes them. (See `vp-business` + `business-legal-compliance`; this is the App Store anti-steering item in memory.)

### Customer Portal
Dashboard → Settings → Billing → Customer Portal:
- Functionality: enable **Cancel subscriptions** (immediately or at period end — pick "at period end"), **Update payment methods**, **View invoice history**
- Customer information: enable **email** + **billing address** updates
- Products: add Pro + Platinum so users can switch between tiers
- Business information: confirm support email = `support@getlionade.com`

### Webhook endpoint
Dashboard → Developers → Webhooks → Add endpoint:
- Endpoint URL: `https://getlionade.com/api/stripe/webhook`
- Listen to: **Events on your account**
- Events to send (exactly these seven):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end` (fires ~3 days before trial end; since our trial IS 3 days it fires at creation — V1 handler just logs, Resend email wire-in is a follow-up ticket)
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- Copy the **Signing secret** → set `STRIPE_WEBHOOK_SECRET` in Vercel.
- Create a SEPARATE test-mode endpoint pointing at a preview URL or `localhost` via `stripe listen --forward-to localhost:3000/api/stripe/webhook` for local testing. Its signing secret goes in `.env.local`.

### Payment methods
Dashboard → Settings → Payments → Payment methods:
- Cards: on (default)
- Apple Pay: enable (domain verification is automatic via Stripe Checkout)
- Google Pay: enable
- Link: enable (one-click for returning Stripe customers)

### Tax ⚠️ (the #1 go-live blocker)
Both `/api/stripe/checkout` AND `/api/stripe/fang-purchase` set `automatic_tax: { enabled: true }`. **If Stripe Tax is not configured, EVERY checkout session creation fails** ("Could not create checkout session") — the buttons will look broken with no obvious cause. So either:
- **(B) Launch without tax now — DONE (2026-06-14).** Both routes now read `automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === "true" }`, which **defaults OFF**, so checkout works the moment you set the keys/price IDs — no Stripe Tax needed today. ✅ This is the default; do nothing.
- **(A) Turn tax ON later** — once you configure Stripe Tax (Dashboard → Settings → Tax: enable Stripe Tax, add the origin address, confirm US sales-tax / EU-VAT registrations), set `STRIPE_AUTOMATIC_TAX=true` in Vercel and redeploy. No code change.

### Email receipts
Dashboard → Settings → Emails:
- Enable **Successful payments** and **Refunds** receipt emails
- Set the from-name to "Lionade"

## 3. DB migrations (already applied to prod)

The Stripe-related schema is already live in production: the subscription columns
(`stripe_customer_id`, `stripe_subscription_id`, `subscription_tier`,
`subscription_status`, `subscription_*`), the `stripe_webhook_events` dedup table
(+ migration 068's `claim_stripe_event` claim), the Fang-IAP idempotency
(migration 070 `credit_fang_iap`), and the admin/effective-plan resolver
(`plan_grants` migration 065 + `recomputeEffectivePlan`). Nothing to run here for
go-live — this is config-only. (Migrations are applied via the Supabase MCP, not
`supabase db push`.)

## 4. Smoke test (test mode)

1. Set Vercel Preview env to test keys + test price IDs.
2. Run `stripe listen --forward-to <preview-url>/api/stripe/webhook` locally to grab a test signing secret.
3. Hit `/pricing` on the preview URL, click Go Pro, complete checkout with `4242 4242 4242 4242`.
4. Verify in Supabase: `select stripe_customer_id, subscription_tier, subscription_status, plan from profiles where id = '<your-user-id>';` → should show `subscription_status = 'trialing'` and `plan = 'pro'` (the 2026-06-14 fix makes `trialing` grant paid access).
5. From the Stripe Dashboard, cancel the test subscription → verify webhook fires and `plan` drops back to `free`.
6. **Fang pack test:** on `/shop`, buy the Small Fang Pouch with `4242 4242 4242 4242` → after the webhook, verify `coins` increased by 5,000 and a `coin_transactions` row of type `fang_iap_purchase` exists. Buy the SAME session twice (replay the webhook from the Dashboard) → verify it does NOT double-credit (migration 070 idempotency).

## 5. Go-live

Once steps 1–4 pass on test mode: swap Vercel env to live keys + live price IDs + live webhook signing secret. The pricing page CTAs (next PR from dev-frontend) will hit `/api/stripe/checkout`.
