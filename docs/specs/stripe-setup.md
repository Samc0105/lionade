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
| `NEXT_PUBLIC_SITE_URL` | Your production URL (`https://getlionade.com`); Preview uses the preview URL | Already required by the email program; checkout / portal now pin `success_url` / `cancel_url` / `return_url` to this value instead of trusting the request `Origin` header (open-redirect hardening) |

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

### Tax
Dashboard → Settings → Tax:
- Enable **Stripe Tax**
- Add origin address (Lionade business address)
- Confirm tax registrations (US sales tax, EU VAT if applicable). `automatic_tax: { enabled: true }` is already on in the Checkout Session.

### Email receipts
Dashboard → Settings → Emails:
- Enable **Successful payments** and **Refunds** receipt emails
- Set the from-name to "Lionade"

## 3. DB migration

Run from local repo root before the first webhook fires:
```
npx supabase db push
```
This applies `supabase/migrations/20260603010601_stripe_subscriptions.sql`.

## 4. Smoke test (test mode)

1. Set Vercel Preview env to test keys + test price IDs.
2. Run `stripe listen --forward-to <preview-url>/api/stripe/webhook` locally to grab a test signing secret.
3. Hit `/pricing` on the preview URL, click Go Pro, complete checkout with `4242 4242 4242 4242`.
4. Verify in Supabase: `select stripe_customer_id, subscription_tier, subscription_status, plan from profiles where id = '<your-user-id>';` → should show `subscription_status = 'trialing'` and `plan = 'pro'`.
5. From the Stripe Dashboard, cancel the test subscription → verify webhook fires and `plan` drops back to `free`.

## 5. Go-live

Once steps 1–4 pass on test mode: swap Vercel env to live keys + live price IDs + live webhook signing secret. The pricing page CTAs (next PR from dev-frontend) will hit `/api/stripe/checkout`.
