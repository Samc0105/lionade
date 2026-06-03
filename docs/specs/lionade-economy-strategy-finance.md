# Lionade Economy Strategy — Finance Memo

**Owner:** business-monetization-finance
**Date:** 2026-06-02
**Status:** Draft for CEO decision. Cross-VP review required (legal, data-economist, product-strategist).
**Scope:** Real-money side of the economy. Pairs with in-game economy doc owned by `data-economist`.

---

## 1. Revenue stack — current + proposed

### Currently live (per `docs/specs/stripe-setup.md`)
- Pro $6.99/mo, $69.99/yr (~17% annual discount)
- Platinum $14.99/mo, $149.99/yr
- 3-day trial, no charge
- No ads, no Fang IAP, no cash-out.

### Proposed additions

**Ad revenue.** Industry eRPMs for EDU-adjacent Gen Z mobile/web (Kahoot free, Duolingo, Brainly, Skribbl), net of ad-network rev share (~30%):

| Format | Pessimistic | Realistic | Optimistic | Cap |
|---|---|---|---|---|
| Rewarded video (opt-in, +Fangs) | $8 | $15 | $30 | 5/day |
| Interstitial (between quizzes) | $3 | $6 | $12 | 3/day |
| Banner (background, Free only) | $0.40 | $0.80 | $1.50 | always |

Engaged Free user ~8 ad imps/day ≈ $0.06 net realistic. At 10K Free DAU = ~$18K/mo ad revenue. **Plan all forecasts off the realistic column.** Pro keeps rewarded (it pays Fangs, users WANT it); no interstitials/banners. Platinum: rewarded only.

**Fang IAP.** Direct purchase. Web prices (iOS adds Apple tax — §4):

| Pack | Web price | Fangs | Bonus | $/1000F |
|---|---|---|---|---|
| Pinch | $0.99 | 1,500 | 0% | $0.66 |
| Bag | $4.99 | 9,000 | 20% | $0.55 |
| Sack | $19.99 | 42,000 | 40% | $0.48 |
| Vault | $49.99 | 120,000 | 60% | $0.42 |

$0.42–0.66 per 1000F is the hard floor under cash-out math: cash-out ratio MUST be worse than IAP/1000F or users buy-then-cash for arbitrage (money-laundering vector).

**Per-action items (dual-priced, per `project_academia_pricing.md`):**

| Item | Fang | $ |
|---|---|---|
| Streak Revive (exists) | 500F | $0.99 |
| Daily Drill skip | 100F | $0.49 |
| Question rescue | 250F | $0.49 |
| 2× Fang boost (1 hr) | 1,500F | $1.99 |
| Mastery topic unlock (Free only) | n/a | $2.99 |

---

## 2. Fang → $ conversion math

### Current earn rates (audited from `app/api/*` and `lib/mastery-plan.ts`)

`PLAN_FANG_MULTIPLIER` = 1.0/1.5/2.0 (free/pro/platinum); spin uses 1.0/1.25/1.5.

**Free engaged user, daily:**
| Source | Per-day |
|---|---|
| Login bonus (tier 3) | 25F |
| Daily drill (5/5 + perfect bonus) | 45F |
| 3 missions (avg 25F each) | 75F |
| 2 quizzes (~150F each, capped 500) | 300F |
| Daily spin (EV ~250F) | 250F |
| Game rewards (party/arena) | 50F |
| **Total** | **~745F/day** |

With multipliers: Free ~745F, Pro ~1,100F, Platinum ~1,490F per day for a maxed-out user. **Median engaged** (not maxed) is closer to 400/600/800.

### Stress-test Sam's 100,000F : $1

| Tier | F/day | Days to $1 | Days to $20 |
|---|---|---|---|
| Free engaged | 745 | 134 | ~7.4 yrs |
| Pro engaged | 1,100 | 91 | ~5 yrs |
| Platinum engaged | 1,490 | 67 | ~3.7 yrs |

**Reject.** Multi-year time-to-first-cash kills the perception that the reward is real. Mistplay pays $5–10/mo to engaged users; Cash App rewards land in days; even Microsoft Rewards lets you hit a $5 gift card in 4–6 weeks.

### Recommended ratio cone

At Pro engaged earn rate (33,000F/mo):

| Ratio | $/mo | Feel | RPM coverage |
|---|---|---|---|
| 100,000:$1 (Sam's) | $0.33 | "fake" | trivial |
| 50,000:$1 | $0.66 | "weak" | trivial |
| **20,000:$1** | **$1.65** | **"snack money, real"** | **comfortable** |
| 10,000:$1 | $3.30 | "generous" | tight |
| 5,000:$1 | $6.60 | "Mistplay-tier" | breaks UE |
| 1,000:$1 (MS Rewards) | $33 | "wow" | requires premium ad density |

### Sustainability check at 20,000F : $1

**Pro engaged:** 33,000F/mo = $1.65 cash-out liability. Net contribution = $3.33 sub + $2.25 rewarded ads = $5.58. Cash-out = 30% of contribution. OK.

**Free engaged:** 22,350F/mo = $1.12 liability. Net contribution = $1.80 ads. Cash-out = 62% of contribution. **Razor-thin — Free cash-out throughput MUST be capped (§3).**

**At 20,000:$1, ad-funded unit economics hold for Pro/Platinum; Free needs throttling but works.**

---

## 3. Cash-out mechanics

**Minimum: $5 (= 100,000F at 20,000:$1).** Reasons: per-payout fixed costs (PayPal $0.30), KYC/1099 burden of micro-payouts, forces ~3 months Free or ~6 weeks Pro engagement before first cash-out. Sam's 20,000F threshold at 100k:$1 = $0.20 is below per-transaction floor. Reject.

**Payout method — V1 = two options:**
1. **Amazon Gift Card (primary).** $0 fee, no KYC, instant delivery via Amazon Incentives API (Tango Card or Tremendous as middleware). Same rail Mistplay/Swagbucks use. Best UE.
2. **PayPal (secondary).** $0.30 + 2.9% per payout (~9% leak on $5). Required for users who refuse Amazon. PayPal handles the 1099-K at $600 lifetime.

Defer: Stripe Connect ($2/mo per active account = brutal), Venmo (API gated), direct deposit (KYC nightmare for under-18 users).

**Frequency: weekly batched, Sunday 00:00 UTC.** Reduces fraud window, batches Amazon API calls, gives support a queue to review.

**Caps:**
- Per-day: $0 (weekly only)
- Per-week: $20
- First 30 days lifetime: $10 (onboarding fraud gate)
- Per-year: **$599 hard cap** to stay below IRS 1099-NEC threshold

**KYC:** designed AROUND the $600/year line. Cap at $599 → ~95%+ of users never trigger 1099. The 5% who cap out see "Lifetime $599 cap reached for 2026; switch to in-app shop" and can resume next year. V1 skips KYC entirely. V2 adds Stripe Identity or Persona ($1.50/verification) for premium users who want to raise the cap.

---

## 4. Apple Tax / anti-steering

- iOS Fang IAP via StoreKit = 30% Apple cut (15% under Small Business Program <$1M — we qualify at launch).
- Net per $4.99 IAP: web ~$4.55 after Stripe; iOS ~$3.49 at 30%, ~$4.13 at 15%.
- Anti-steering (2024 settlement still active 2026): cannot tell users inside the iOS app "buy Fangs cheaper on the web."

**Recommendation:**
- **Web-first launch.** Fang IAP + cash-out shipped on web only for V1.
- **iOS V2:** StoreKit Fang IAP at 30%-premium prices (iOS Bag = $6.99 for the same 9,000F that web sells at $4.99). Cash-out stays web-only because StoreKit doesn't permit cash redemption of IAP-purchased currency (compliance risk).
- **No price-comparison messaging in iOS app.** Legal to confirm phrasing.

---

## 5. Free vs Pro vs Platinum monetization split

**Monthly net per realistic engaged active user:**

| Tier | Sub net | Ad net | IAP buyer % × ARPU | Cash-out liability | **Net/mo** | 12-mo LTV |
|---|---|---|---|---|---|---|
| Free | $0 | $1.80 | 2% × $4.99 = $0.10 | -$1.12 | **$0.78** | $9.36 |
| Pro | $3.33 | $2.25 | 8% × $4.99 = $0.40 | -$1.65 | **$4.33** | $52 |
| Platinum | $8.50 | $1.20 | 15% × $4.99 = $0.75 | -$2.23 | **$8.22** | $99 |

**Takeaways:**
- Free is barely profitable. Acceptable funnel (target 5% Free→Pro conversion justifies LTV) but cash-out caps + ad density non-negotiable.
- Pro is the workhorse: subscription is majority of value; ads + IAP secondary.
- Platinum: never show banners/interstitials. Lean into Fang IAP, cosmetics, cash-out for premium feel.

---

## 6. Hard recommendations Sam should lock (binary YES/NO)

1. **Fang : $ ratio = 20,000 : $1.** YES / NO.
2. **Minimum cash-out = $5 (= 100,000F).** YES / NO.
3. **Payout method V1 = Amazon Gift Card + PayPal only.** YES / NO.
4. **Weekly batched, $20/week cap, $599/year hard cap to avoid KYC.** YES / NO.
5. **Web-first launch; iOS Fang IAP V2 at 30%-premium prices; iOS cash-out deferred.** YES / NO.

---

## 7. Cross-VP coordination required before launch

- **`business-legal-compliance`** — Money transmitter classification? Sweepstakes implications? Per-state rules (WA, AZ, ID, MT cash-prize). 1099 tax-reporting boilerplate. Required before any cash-out ships.
- **`data-economist`** — Faucet rebalance once cash-out is live. Current rates were tuned for closed economy; cash-out flips them into a real liability. Sinks (shop, boosts) need beefing up.
- **`product-strategist`** — Shop catalog expansion, premium cosmetics roadmap, Battle Pass season design.
- **`dev-backend`** — Amazon Incentives API integration (Tango Card or Tremendous middleware). Stripe Connect NOT used V1.
- **`business-ops-customer-success`** — Cash-out dispute flow, weekly fraud queue triage, KYC escalation when V2 lands.
