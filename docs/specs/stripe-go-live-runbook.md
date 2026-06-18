# Stripe go-live runbook — exact dashboard click-path

Purpose: turn on real Pro/Platinum subscriptions + Fang-pack purchases on
getlionade.com. The app code is complete and correct — this is pure config.
Every value below is what the code actually reads (verified against
`lib/stripe.ts`, `lib/fang-packs.ts`, `app/api/stripe/*`).

Time: ~25 min. Do it ALL in Stripe **Live mode**.

---

## 0. Switch to Live mode (do this first)

1. Stripe Dashboard → top-left, the mode toggle must read **Live mode** (not
   "Test mode"). The #1 silent failure is creating prices in Test then setting a
   live secret key — the price IDs won't resolve and checkout 502s. Everything
   below is in Live.

---

## 1. Create the 6 Products + 8 Prices

Go to **Product catalog → + Create product** for each. After saving each price,
click the price → copy its `price_…` ID (top of the price detail, or the "···"
menu → Copy price ID). Paste each into the env-var column — you'll enter them in
Vercel in step 4.

### Subscriptions (recurring)

| Product name | Price | Billing | → env var |
|---|---|---|---|
| **Pro** | $6.99 | Recurring · Monthly | `STRIPE_PRICE_ID_PRO_MONTHLY` |
| **Pro** (same product, 2nd price) | $69.99 | Recurring · Yearly | `STRIPE_PRICE_ID_PRO_ANNUAL` |
| **Platinum** | $14.99 | Recurring · Monthly | `STRIPE_PRICE_ID_PLATINUM_MONTHLY` |
| **Platinum** (same product, 2nd price) | $149.99 | Recurring · Yearly | `STRIPE_PRICE_ID_PLATINUM_ANNUAL` |

For Pro and Platinum, create ONE product each and add TWO prices to it (Add
another price → monthly, then again → yearly). On the product page: name it,
set price → "Recurring", pick the interval, Save. Repeat for the yearly price.

### Fang packs (one-time)

Create 4 products, each with a single **one-time** price (NOT recurring):

| Product name | Price | Grants | → env var |
|---|---|---|---|
| **Small Fang Pouch** | $0.99 | 5,000 Fangs | `STRIPE_PRICE_ID_FANGS_S` |
| **Medium Fang Sack** | $4.99 | 30,000 Fangs | `STRIPE_PRICE_ID_FANGS_M` |
| **Large Fang Chest** | $19.99 | 140,000 Fangs | `STRIPE_PRICE_ID_FANGS_L` |
| **Whale Fang Vault** | $49.99 | 400,000 Fangs | `STRIPE_PRICE_ID_FANGS_XL` |

The Fang grant is server-controlled (the code grants the amount above no matter
what name/price you use) — but set the dollar amount to match so the charge
equals what the Shop advertises. Make sure each is a **One-time** price; a Fang
price accidentally marked Recurring is wrong.

You now have 8 `price_…` IDs mapped to 8 env vars.

---

## 2. Register the webhook

1. **Developers → Webhooks → + Add endpoint**.
2. Endpoint URL: `https://getlionade.com/api/stripe/webhook`
3. "Select events" → add exactly these 7:
   - `checkout.session.completed`  ← credits Fang packs; omit it and paid Fangs never land
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Add endpoint → on the endpoint page, **Reveal** the "Signing secret"
   (`whsec_…`) → copy it → this is `STRIPE_WEBHOOK_SECRET`. It MUST be this live
   endpoint's secret; a test-mode `whsec_` makes every live webhook 400 and
   nothing grants even though checkout looks fine.

---

## 3. Customer Portal (for "Manage billing" / cancel)

1. **Settings → Billing → Customer portal** → Activate.
2. Enable: cancel subscription (at period end), update payment method, invoice
   history. Under "Products", add Pro + Platinum so users can switch tiers.
   (Without this, the `/api/stripe/portal` route 502s when a Pro user clicks
   Manage billing.)

---

## 4. Set env vars in Vercel + redeploy

**Vercel → project `lionade` → Settings → Environment Variables**, scope
**Production** (and Preview with TEST-mode IDs if you want preview to transact):

Add the 8 price IDs from step 1 + verify the 3 keys are LIVE:

```
STRIPE_PRICE_ID_PRO_MONTHLY=price_…
STRIPE_PRICE_ID_PRO_ANNUAL=price_…
STRIPE_PRICE_ID_PLATINUM_MONTHLY=price_…
STRIPE_PRICE_ID_PLATINUM_ANNUAL=price_…
STRIPE_PRICE_ID_FANGS_S=price_…
STRIPE_PRICE_ID_FANGS_M=price_…
STRIPE_PRICE_ID_FANGS_L=price_…
STRIPE_PRICE_ID_FANGS_XL=price_…
STRIPE_SECRET_KEY=sk_live_…            # verify it's sk_live_, not sk_test_
STRIPE_WEBHOOK_SECRET=whsec_…          # the LIVE endpoint's secret from step 2
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…   # already set; not load-bearing, but make it live
```

Leave `STRIPE_AUTOMATIC_TAX` unset (or `false`) until Stripe Tax is configured —
setting it true prematurely makes every checkout fail.

Then **Redeploy** (Vercel → Deployments → ··· → Redeploy) so the new env is picked up.

---

## 5. Apply the DB migration (required for Fang packs to credit)

In the Supabase SQL editor, run
`lib/migrations/20260618130000_coin_tx_types_and_competitive_settle.sql`.
Without it the live `coin_transactions` CHECK rejects `fang_iap_purchase`, so a
Fang purchase would charge the card but the credit RPC throws and the buyer gets
nothing.

---

## 6. Verify (test with a real card, then refund yourself)

1. **Pro:** /pricing → Go Pro → you should land on Stripe Checkout (not a "Couldn't
   open checkout" toast). Pay → you should return to /account and see Pro active.
2. **Fang pack:** /shop → buy the Small pouch → pay → +5,000 Fangs land.
3. **Webhook health:** Stripe → Developers → Webhooks → your endpoint → "Recent
   deliveries". 200 = good. 400 = wrong signing secret (step 2). 500 = a handler
   threw (check the migration in step 5 is applied + the price IDs match).
4. Refund your test charges in Stripe (Payments → the charge → Refund).

---

## Diagnostics if something still fails

- Checkout shows "Plan unavailable" / "Pack unavailable" → that price-ID env var
  is unset/typo'd in Vercel. Check Vercel function logs for
  `[stripe-checkout] missing price id env`.
- Checkout opens but card is charged and plan/Fangs never appear → webhook.
  Check Recent deliveries (400 = secret, 500 = handler/migration).
- "test vs live" → a `price_…` created in Test mode does not exist under the live
  key; recreate it in Live mode. (You can't tell test vs live by the ID prefix.)
