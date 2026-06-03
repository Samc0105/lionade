## Lionade Economy Strategy: Legal/Compliance Memo (Cash-out, Ads, Fang IAP)

Status: draft, awaiting lawyer review before any V2 cash-out work begins
Author: business-legal-compliance (NOT an attorney; this is a risk map, not a legal opinion)
Date: 2026-06-02
Coordinate with: business-monetization-finance (dollar economics), data-economist (Fang faucet/sink), business-ops-customer-success (blacklisted-state refusal support burden)

### 1. Cash-out classification — what regulatory regime applies?

- **Money transmitter (FinCEN).** If Lionade holds user balances denominated in dollar-redeemable Fangs and remits cash to bank accounts, the platform plausibly meets FinCEN's "money transmitter" definition. That triggers state-by-state MTL licensing (50-state, ~$1M+ surety bonds, multi-year). **Mitigation:** route payouts through Stripe Connect (Stripe is the MT of record) or Tango Card / Tremendous for gift cards. Both move the MT burden off Lionade. This is the single biggest architectural decision.
- **Sweepstakes test.** Three prongs: consideration, chance, prize. Lionade is skill-based study, so the chance prong is weak for earn-via-study. The Daily Spin is the wildcard — see below. The consideration prong is the danger: if a user MUST pay (Fang IAP, Pro sub, ad-view) to earn Fangs that cash out, that is consideration in many states. Free-alternative-means-of-entry (AMOE) is the standard escape valve; gameplay-earned Fangs probably qualify, but the structure must be airtight.
- **Daily Spin retroactive coloring.** Today the spin is free (zero consideration) and pays only in-app Fangs, so it is not a sweepstakes. The moment Fangs become cash-redeemable, the Spin becomes a chance-based path to real money. That is gambling under several state definitions even with zero consideration. **Recommendation: when V2 ships, Daily Spin payouts must be capped to non-cashable Fang buckets, or the spin must be removed.**
- **Virtual currency redeemable for real value.** WA, IL, NY treat this unfavorably. Industry workaround: bank-convertible cash is high-risk; Amazon / Visa gift cards are lower-risk; "donate to charity" is lowest-risk. Roblox DevEx, Mistplay, and Skillz all operate within carve-outs that took years and lawyers to build.
- **IRS reporting.** $600/year cash-equivalent payouts to one user triggers 1099-NEC (Form 1099-K threshold dropped to $600 in 2024). Need W-9 collection at first cash-out request and 1099 issuance January each year. Stripe Connect Express handles this automatically; gift-card vendors do not.

### 2. Per-state landscape (rough, requires lawyer confirmation)

- **CA** — gray. Skill-based earn is generally OK; sweepstakes registration not required below $5,000 prize; consumer-protection rules (auto-renewal, refund) are strict.
- **NY** — high risk. Broad gambling definition; AG aggressive on skill-vs-chance line. Skillz precedent helps but is narrow. Likely a state to exclude in V1 cash-out.
- **WA** — highest risk. "Thing of value" has been stretched to include in-game advantage (Big Fish settlement, 2018). Block cash-out for WA users at launch.
- **IL** — high risk. Loot box scrutiny + broad gambling statute. Block at launch.
- **AZ** — moderate. Skill-based contests permitted with registration if prize value high.
- **TX** — moderate. Skill-based exception is robust; cash-out should be defensible.
- **FL** — moderate. Sweepstakes-friendly with proper registration above $5,000.

Precedent worth studying with counsel: Mistplay (rewarded-play, gift cards only), Skillz (skill cash games, geo-restricted), Marvel Snap Token Shop (purchase-only, no cash-out), Roblox DevEx (creator-only, KYC heavy), Duolingo Gems (cosmetics only, no cash-out — clean model).

### 3. Apple / Google App Store rules

- **Apple 5.3 (real-money gaming).** Triggered if Lionade enables real-money prizes won via gameplay. Requires geographic restriction, age gates (17+ for many regions), and disclosure of licenses. Cash-out from gameplay-earned Fangs likely triggers 5.3 on iOS. Trust Issues memo already flags this.
- **Apple 3.1.5(a).** Virtual currency purchased in-app MUST use IAP (30% / 15% tax). Fang IAP on iOS is non-negotiable IAP.
- **Apple 3.1.5(b).** "Virtual currency may not be used as a vehicle for cashing out." This is the hard wall. **Apple-IAP-purchased Fangs cannot be cashed out, ever.** Cashable Fangs must come from non-IAP earn only (gameplay, ads, free signup bonuses). Implementation: separate ledger column `fangs_cashable` vs `fangs_iap`. Mixing them invites App Store termination.
- **Apple anti-steering.** Cannot tell users "buy Fangs cheaper on web." Web payment availability is fine; in-app mention of it is not (recent Epic ruling loosened this but still risky; lawyer review).
- **Google Play.** Similar IAP rule (Billing Library mandatory for digital goods) but Google permits more flexibility on rewarded-cash apps under their "Real-Money Gambling, Games, and Contests" policy with country-specific allowlists. Still requires age gate + disclosure.

### 4. COPPA / age gate

Lionade is 13+ gated at signup; COPPA not triggered. Risks remain:

- **Minor contracts.** A 13-17 year old cashing out enters a financial contract; most states allow minors to void contracts. Practical guardrail: require age 18+ for cash-out (Fangs accrue, redemption gated). Parental consent flow is operationally painful; the 18+ gate is cleaner.
- **State child labor laws.** Generally do not apply since gameplay is not employment, but a few state AGs have probed "kids earning money from apps" angles. 18+ cash-out gate sidesteps this entirely.

### 5. Ad rules

- **Apple ATT.** Behavioral / cross-app ad tracking requires the ATT prompt. Contextual ads do not. Recommend contextual + first-party rewarded ads only at launch to avoid the ATT opt-in tax.
- **Google AdMob + Families.** Lionade is not Family-designated (13+, not under-13), so the strictest Families ad policies do not apply. Standard AdMob policies do, including no incentivized clicks (rewarded VIEW is fine, rewarded CLICK is banned).
- **FTC rewarded-ad concern.** Ad view → Fang → cash chain for minors is a plausible FTC "unfair practice" target. The 18+ cash-out gate neutralizes this. Until cash-out exists, rewarded ads for in-app Fangs only are low risk.

### 6. Verdict per launch path

- **Path A (cosmetics + dollar IAP, no cash-out, no ads).** Verdict: **safe to ship now.** Biggest exposure: standard consumer-protection (refund policy, auto-renewal disclosure, CA SB-313). No regulatory blocker.
- **Path B (ads + Fang IAP, no cash-out).** Verdict: **safe with standard disclosures.** Biggest exposure: ATT compliance on iOS + clear "Fangs have no cash value" disclosure in TOS to avoid any virtual-currency-as-money claims. Ship Q3 2026 realistic.
- **Path C (full cash-out via gift card or Stripe Connect).** Verdict: **NOT shippable on a 6-month timeline.** Biggest blocker: state-by-state legal review + MT routing architecture + KYC + 1099 + Apple 5.3 review. Minimum viable protection: route via Stripe Connect or Tango (no MT license required by Lionade), geo-restrict to a TX/FL/CA allowlist at launch, $600/year per-user cap to avoid 1099 complexity in year one, separate cashable ledger, 18+ gate, explicit TOS clauses on eligibility/disputes/forfeiture, AMOE preserved for every cash-earn path. Lawyer-drafted TOS only.

### 7. Recommended V1 launch path

1. **Now to Q3 2026:** Ship Path A. Validate dollar economics with Pro subs + cosmetic IAP. (`business-monetization-finance` owns.)
2. **Q3 2026:** Ship Path B. Ads + Fang IAP, both with the "Fangs are non-redeemable virtual currency" disclosure baked into TOS and the IAP receipt. Add the cashable-vs-non-cashable ledger split now even though the cashable column stays at zero, so the V2 architecture is ready. (`data-economist` should design the Fang faucet/sink with this split in mind.)
3. **Q4 2026 to Q1 2027:** Engage a fintech / iGaming lawyer (NY or DE bar). Draft state allowlist, KYC flow, payout TOS, Apple 5.3 disclosure pack.
4. **Q2 2027:** Ship Path C web-only first, geo-restricted to ~5 states, gift-card-only (no bank), $600/year cap, 18+ gate. iOS port follows only after web runs 90+ days clean.
5. **2027+:** Expand state allowlist, add Stripe Connect cash payout, raise cap.

### 8. Questions ONLY a real lawyer can answer

1. Does routing payouts via Stripe Connect or Tango Card fully transfer money-transmitter liability away from Lionade in all 50 states, or does Lionade still need an MT license in any state?
2. Does the existing free Daily Spin become a gambling device the moment any downstream Fang use is cash-redeemable, even if Spin payouts are flagged non-cashable?
3. Does Apple 3.1.5(b) require a hard ledger separation (provable to App Review on request), or is a TOS clause sufficient?
4. In which states does the consideration prong of the sweepstakes test bar AMOE-based cash earn when the same user also pays for Pro?
5. Is an 18+ cash-out gate sufficient to neutralize state minor-contract and child-labor exposure, or is parental consent still required for 13-17 year-old Fang accrual?
6. Does the rebranded Trust Issues game change classification if Fang stakes are added after V2 cash-out ships (i.e. does cash convertibility retroactively make staked rounds gambling)?
7. What is the minimum geo-restriction allowlist that lets us ship cash-out without triggering NY, WA, or IL AG attention?
8. Does Lionade need to register as a sweepstakes operator in any state at any prize threshold under Path C as drafted?

### 9. Coordination

- `business-monetization-finance` — model the dollar P&L for each path; Path B is where the real revenue starts.
- `data-economist` — design the dual-ledger Fang faucet/sink with cashable vs non-cashable columns BEFORE Path B ships.
- `business-ops-customer-success` — draft the support macros for blacklisted-state refusal, KYC failures, and 1099 questions.

**This memo is not legal advice. Engage a licensed fintech / iGaming attorney before any Path C work.**
