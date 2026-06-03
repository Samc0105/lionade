# Fang IAP — TOS + Privacy Clauses + Operational Templates

Status: DRAFT — author is NOT a licensed attorney. Lawyer review REQUIRED before deployment.
Author: business-legal-compliance
Date: 2026-06-02
Related: docs/specs/lionade-economy-strategy-legal.md (cash-out V2 memo), docs/specs/stripe-setup.md (Stripe integration), docs/CHANGELOG.md 2026-06-02

---

## TODO — Sam, do these BEFORE deploying Fang IAP

**Paste the clauses below into the listed files, then commit:**

1. [ ] **Paste TOS section (this doc Section 1)** into `app/terms/page.tsx`. The current file at that path is a placeholder stub ("Our full terms of service will be published before public launch"). You cannot ship paid IAP against a placeholder TOS. The full Section 1 below is structured to be dropped into a real TOS, but the surrounding TOS sections (acceptance, eligibility, account, IP, disputes, governing law, etc.) ALSO need to exist before IAP can ship. Recommendation: get a lawyer to draft a full TOS using Section 1 below as the Fang-currency portion.
2. [ ] **Paste Privacy Policy paragraph (Section 2)** into `app/privacy/page.tsx`. Same caveat — the current file is a placeholder. Full Privacy Policy must list every sub-processor (Supabase, Stripe, OpenAI, Gemini, Groq, Resend, CloudFront, DiceBear, Sentry, Vercel) — see the existing sub-processor list in `business-legal-compliance` agent docs.
3. [ ] **Pass the footnote text (Section 3) to dev-frontend** for the `/account?iap=success` toast/footnote. They are wiring the success state in parallel.
4. [ ] **Paste the refund email template (Section 4) into the Notion / customer-support playbook** for business-ops-customer-success.
5. [ ] **Add the California consumer-protection addendum (Section 5)** if California users are not blocked.
6. [ ] **Hire a real attorney** to review the TOS + Privacy Policy in full before the FIRST live IAP transaction. Stripe IAP without a real TOS = chargeback magnet + state-AG exposure. Budget $1.5k to $3k for a small-firm review pass on consumer-facing TOS + Privacy Policy for a virtual-currency product.
7. [ ] Update `app/terms/page.tsx` and `app/privacy/page.tsx` "Last updated" stamp from "February 2026" to "June 2026" on the same commit.

---

## 1. TOS update — paste into app/terms/page.tsx

Insert as a new section. Suggested placement: after general "User Accounts" / "Acceptable Use" sections, before "Disputes / Governing Law".

```
## Fangs — Virtual Currency

a. Nature of Fangs. Fangs are a virtual currency used solely within Lionade for digital items, in-app boosts, cosmetic rewards, and other services we make available from time to time. Fangs are licensed to you, not sold, and you have no ownership interest in any Fang balance.

b. No Cash Value. Fangs have no cash value and are not redeemable for cash, equivalents, or any other monetary instrument. If, in the future, Lionade introduces a mechanism for converting Fangs to cash or other tangible value, this clause will be amended at that time by separate written notice on the Lionade website and in the app. Until and unless such notice is given, Fangs are non-monetary.

c. Purchased Fangs. Fangs purchased through Stripe ("IAP Fangs") are non-refundable except as required by applicable consumer protection law. Lionade offers a courtesy 7-day refund window for IAP Fangs purchases. See our refund FAQ at getlionade.com/help/refunds for details and exclusions.

d. Non-Transferability. Fangs cannot be transferred, gifted, sold, or assigned between user accounts, and any attempt to do so (including via third-party trading services, account sharing, or automated farming) is a breach of these Terms and may result in account suspension and forfeiture of all Fangs on the affected account(s).

e. Pricing and Rate Changes. Lionade reserves the right to modify Fang grant rates, shop prices, multiplier values, conversion rates, and IAP package contents at any time, with reasonable advance notice for material changes. Fang values awarded for any given action are determined at the time of the action; previously credited Fangs are not retroactively re-valued.

f. Account Termination and Inactivity. Unused Fangs may be forfeited if (i) your account is terminated for violation of these Terms, (ii) your account remains inactive (no login) for 24 consecutive months, or (iii) Lionade discontinues the Fang program in full with at least 30 days' notice. In the case of (iii), Lionade will make a reasonable effort to refund IAP Fangs purchased within the prior 90 days.

g. Not a Financial Institution. Lionade is not a bank, money transmitter, payment processor, or other financial institution. Fang balances are not deposits, are not insured by any government agency, and do not earn interest. Fang transactions on the Lionade platform are not banking, securities, or money-transmission activities.

h. Tax. You are solely responsible for any taxes that may apply to your use of Fangs or any digital items obtained with Fangs.
```

### Notes for lawyer
- **Clause (b)** is the load-bearing one for App Store review (Apple Guideline 3.1.1 disallows real-money external payments; clause (b) makes it clear that Fangs are NOT a real-money instrument). Verify the "amended by separate written notice" mechanism is enforceable in your governing-law jurisdiction (Delaware, NY, CA all read it differently).
- **Clause (c)** references a "7-day refund window" — verify this is consistent with EU consumer law (14-day cooling-off under Consumer Rights Directive for digital content, with caveats around immediate-delivery digital goods). For US-only V1, 7 days is the courtesy window. If EU access is enabled, the policy must mention 14 days for EU residents.
- **Clause (f)(ii)** — 24-month inactivity forfeiture is conservative. Some states (CA, NJ, KY, TX) have escheat / unclaimed property statutes that may require longer holding periods OR transfer to the state. Lawyer review REQUIRED before relying on this clause; in particular CA's Unclaimed Property Law has been applied to gift-card-like products and Fangs may sit in the same regulatory bucket if challenged.
- **Clause (g)** — explicit "not a money transmitter" disclaimer is included because some state regulators (NY DFS in particular) have probed game-currency programs. The clause helps but is not a defense; if Fangs ever cash out (V2 2027), state-by-state money-transmitter analysis is required (covered in `lionade-economy-strategy-legal.md`).
- Governing-law and dispute-resolution clauses are NOT in this section — they belong in the broader TOS and need lawyer drafting separately.

---

## 2. Privacy Policy update — paste into app/privacy/page.tsx

Insert as a new "Payment Processing (Stripe)" subsection in the Privacy Policy. If the existing policy has a sub-processors table, add Stripe as a row AND include the prose below.

```
## Payment Processing (Stripe)

When you purchase Fangs, a Lionade subscription, or any other paid product, we share the following information with our payment processor, Stripe, Inc., to complete the transaction:

- Your email address
- Your billing information (name, billing address, and payment method as collected by Stripe's hosted checkout)
- Purchase metadata (product, price, quantity, currency, timestamps, and your Lionade user ID)

We do not store full credit card numbers, CVV codes, or full bank account numbers on Lionade servers. Stripe handles all card data in a PCI-DSS-compliant environment. We retain a Stripe customer reference, the last four digits of your payment method (where Stripe provides this), and a transaction history for your account.

Stripe's processing of your payment information is governed by Stripe's privacy policy, available at https://stripe.com/privacy. Stripe acts as a separate data controller for the payment information you submit to it directly.

We retain purchase history (transaction records, invoice metadata, and Fang IAP grant logs) for seven (7) years to comply with US tax and accounting recordkeeping requirements, including IRS recordkeeping rules. Account deletion under your data-deletion rights removes your profile and gameplay data; tax-required transaction records are anonymized and retained for the seven-year window, then deleted.
```

### Notes for lawyer
- The "seven years" retention is based on IRS general recordkeeping guidance (publication 583 / 552). Some state tax authorities require longer (e.g. CA Franchise Tax Board has stated indefinite retention for unresolved disputes); verify against the jurisdictions Lionade files in.
- "Separate data controller" language follows GDPR controller-vs-processor framing. If Lionade decides Stripe is a processor (not a co-controller), the language must change — typically Stripe is treated as a separate controller for card-data because the card data flows through Stripe's hosted checkout, not Lionade's servers.
- Add Stripe to the sub-processors disclosure list elsewhere in the privacy policy (the full list also includes Supabase, OpenAI, Gemini, Groq, Resend, CloudFront, DiceBear, Sentry, Vercel).

---

## 3. IAP receipt disclosure — success-page footnote

For dev-frontend to wire on the `/account` page when `?iap=success` is present in the URL.

**Display location:** small text below the success toast / confirmation card. Not a modal, not a banner. ~12px font, 70% opacity, subtle. One line or two-line wrap.

**Exact copy:**

> Your Fangs have been credited. Fangs have no cash value and are non-refundable beyond our 7-day window. See our [Terms](/terms) and [Refund Policy](/help/refunds).

**Notes:**
- No em-dashes. (Project standing order.)
- Two inline links: `/terms` and `/help/refunds`. If `/help/refunds` doesn't exist yet as a route, link to a `#refunds` anchor inside `/terms` until the help center ships.
- Footnote also renders inside the Stripe-emitted email receipt is OUT of scope here (Stripe's receipt template is configured in the Stripe Dashboard; if Sam wants to add a custom note to receipts, that's a Stripe Dashboard config task, not a code task).

---

## 4. Refund email template — for business-ops-customer-success

Save in the customer-support playbook (Notion / wherever the team keeps templates).

### Template A — Within 7 days, granting refund

Subject: Refund processed for your Lionade Fangs purchase

Hey {{first_name}},

Thanks for reaching out. I've processed a full refund for your Fang purchase on {{purchase_date}}. The {{usd_amount}} will return to your original payment method within 5 to 10 business days, depending on your bank.

The {{fang_amount}} Fangs from that purchase have been removed from your account balance. Your other Fangs, including any earned through gameplay, are unaffected.

If you ran into a problem with Lionade that prompted the refund, I'd love to hear what happened. We're always trying to make the app better.

Cheers,
{{support_agent_name}}
Lionade support
support@getlionade.com

**Operational steps before sending:**
1. Process refund in Stripe Dashboard → Payments → find transaction → Refund (full).
2. Run the Fang clawback (see runbook for the `fangs_iap` deduction query — equivalent Fangs subtracted; if user's current `fangs_iap` is less than the purchased amount, deduct what is available; do NOT touch `fangs_cashable`).
3. Note the case in the support log with the Stripe charge ID.

### Template B — Past 7 days, declining refund

Subject: About your Lionade Fangs purchase

Hey {{first_name}},

Thanks for reaching out about your Fang purchase from {{purchase_date}}.

Our refund window is 7 days from the purchase date, which has passed for this transaction. I'm not able to issue a refund on this one.

If there's a specific problem with the app or your account I can help with, let me know what's going on and I'll do what I can. If you'd like to keep using your Fangs, here are some things you can spend them on: {{contextual_shop_suggestions}}.

Thanks for being part of Lionade.

{{support_agent_name}}
Lionade support
support@getlionade.com

**Operational notes:**
- Stripe Dashboard chargebacks initiated by the customer AFTER you've declined are a separate workflow — see the chargeback-response template (TODO: write that one separately) and the refund-policy section of `/terms` as evidence.
- If the customer escalates (BBB complaint, AG complaint, social media), escalate to Sam BEFORE responding further.

### Template C — User already spent the Fangs, then asks for a refund

Subject: About your Lionade Fangs purchase

Hey {{first_name}},

Thanks for reaching out. I checked your account and I can see the Fangs from your {{purchase_date}} purchase were spent on {{items_purchased}} between {{spend_start}} and {{spend_end}}.

Here's how I can help. I'm able to issue a refund for the {{usd_amount}} purchase back to your original payment method. Because the Fangs from that purchase were already used to acquire {{items_purchased}}, those items will stay on your account. This keeps things fair and protects the account from accidental account-history changes.

If that works for you, just confirm and I'll process the refund. If you'd rather we leave everything as is, that's fine too. Let me know.

{{support_agent_name}}
Lionade support
support@getlionade.com

**Operational notes:**
- This is the anti-fraud edge case. We refund the dollars (good faith) but do NOT reverse the in-game items, which closes a "buy Fangs, spend immediately, refund, repeat" exploit loop.
- The email phrasing avoids any accusation. "Keeps things fair" is the framing.
- If the customer asks for a "full refund AND the items removed," escalate to Sam. Default policy is to honor the dollar refund but keep the items — this prevents account-history mutations that affect leaderboards, friend visibility, and any social proof tied to those items.
- Stripe refund proceeds the same way: Dashboard → Refund (full). On the Fang ledger, set `fangs_iap = greatest(fangs_iap - {{fang_amount}}, 0)` — this will likely net to 0 since they already spent down. Do NOT touch `fangs_cashable` or reverse any `coin_transactions` rows.

---

## 5. State-specific addenda

### California — REQUIRED if California users are not blocked

California consumer protection (Civil Code §§1749.45–1749.6 and the CLRA) imposes specific disclosure obligations on gift-card-like and prepaid-digital products. Fangs purchased for cash through Stripe likely qualify under one or more of these regimes if challenged. CA users should see a state-specific notice in TOS, OR Lionade should geo-block California IAP until lawyer review confirms compliance.

**Suggested CA-specific addendum (paste under the Fangs section in TOS, in a "California Residents" subsection):**

```
California Residents. If you are a California resident, the following additional terms apply:

- IAP Fangs purchased for cash are governed in part by California Civil Code §§ 1749.45 to 1749.6 to the extent applicable to prepaid digital currencies.
- IAP Fangs purchased with a cash balance of less than $10 are redeemable for the cash value of the unused balance upon written request to support@getlionade.com, in accordance with applicable California law. Earned (non-IAP) Fangs are excluded from this provision.
- For complaints, you may contact the California Department of Consumer Affairs, Consumer Information Division, 1625 North Market Blvd., Suite N 112, Sacramento, CA 95834, or by telephone at (800) 952-5210.
```

**LAWYER REVIEW REQUIRED before adopting the second bullet.** The $10-cash-back-rule for unused gift-card balances is California law for retailer-issued gift cards, and applying it to game virtual currency is a stretch — but if a CA AG decided Fangs are gift-card-like, the rule applies retroactively. Lawyer should confirm whether to (a) adopt the bullet defensively, (b) skip the bullet and rely on the no-cash-value framing in clause (b), or (c) geo-block CA IAP entirely until V2's cash-out framework is in place.

### Other state-specific notes

- **New York.** NY has aggressive virtual-currency money-transmitter enforcement (see BitLicense). Currently a low risk because Fangs do not cash out, but flag for re-review if V2 ships in NY.
- **Florida, Washington.** Both states have stretched "thing of value" definitions in gambling-adjacency cases. Daily Spin and any future Fang-stake mechanic should be re-reviewed before enabling for FL/WA users.
- **Hawaii, Utah, Minnesota.** No specific IAP issues today, but these states historically have stricter "online gaming" enforcement; relevant if a Fang-stake Trust Issues / Arena mode ever ships.
- **Massachusetts, Illinois.** Both have right-to-deletion laws (similar to CCPA / GDPR-lite). The Privacy Policy retention paragraph in Section 2 satisfies these as long as the 7-year tax-record exception is honored.

### V1 minimum recommendation

For Fang IAP V1 (cash-in only, no cash-out), the MINIMUM state-specific work is the California addendum above. Everything else is a "monitor and reassess at V2" item.

---

## 6. iOS App Store-specific language requirements

The web TOS will be the document Apple references during cross-platform review of the Lionade iOS app, EVEN THOUGH the iOS app does not have Fang IAP today (iOS IAP requires StoreKit per anti-steering rules, queued as a separate spec).

**Apple guideline alignment:**

- **Guideline 3.1.1 (In-App Purchase):** Apple requires that any "use of in-app digital currencies" follow Apple's IAP rules. Web-only Stripe IAP is permitted as long as the iOS app does not link to it or promote it (anti-steering). Clause (b)'s "no cash value" language matches Apple's expectations for virtual currency disclosure (Apple's developer documentation specifically calls out "virtual currencies with no real-world value").
- **Guideline 5.3.4 (Real-Money Gaming):** Lionade does not allow real-money gaming, and clause (b) + clause (g) make this explicit. Keep clause (b) intact even if business pressure later asks for cash-out language — that would push the app under 5.3 review.
- **Guideline 3.2.1(v) — Acceptable Business Models:** "Goods and services consumed within the app must use IAP." This is why Lionade iOS cannot link to web Stripe IAP. The web TOS does not need to mention iOS — separate TOS clauses are not required for iOS since the web TOS covers both.

**Verification:** Clause (b) language is consistent with the disclosures used by Roblox (Robux), Discord (Nitro Boost credits), and Fortnite (V-Bucks). Apple has accepted these framings. **Lawyer review still recommended** to verify the exact phrasing against the most recent Apple review guidelines (the guidelines change every 6 to 12 months).

**No iOS-specific clause needed in the web TOS.** When iOS IAP launches via StoreKit (V1.5 or V2), a separate Apple-aligned disclosure must be added to the iOS Settings → About → Legal screen and to the iOS-specific in-app purchase flow.

---

## Lawyer-review red flags — summary

The following clauses MUST be reviewed by a licensed attorney BEFORE Fang IAP ships to real customers:

1. **TOS Section 1 (entire section).** Virtual-currency clauses are not standard boilerplate; every word matters.
2. **TOS clause (b) "no cash value" amendment mechanism.** Verify enforceability under chosen governing law.
3. **TOS clause (c) "7-day refund window".** Verify against EU 14-day cooling-off if EU access is enabled.
4. **TOS clause (f)(ii) 24-month inactivity forfeiture.** Conflicts possible with state unclaimed-property statutes.
5. **Privacy Policy 7-year retention.** Verify against the specific tax jurisdictions Lionade files in.
6. **California addendum.** Specifically the $10-cash-back bullet — adopt, skip, or geo-block.
7. **Refund template C (already-spent edge case).** Confirm the "refund cash, keep items" policy is defensible against a chargeback dispute.
8. **Cross-state IAP exposure.** A quick state-by-state scan from a multi-state-licensed firm before V1 launch is cheap insurance.

Estimated lawyer-review cost for the above: $1.5k to $3k from a consumer-tech-focused boutique firm. Faster turnaround if Lionade pre-pays an annual retainer; the V2 cash-out work (2027) will require substantially more legal hours.

---

End of spec.
