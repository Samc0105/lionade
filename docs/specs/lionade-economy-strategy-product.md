# Lionade Economy Strategy — Product Memo

Owner: product-strategist (web). Sibling memos: finance (pricing math), legal (cash-out compliance), economy (faucet/sink balance). Defer dollar amounts, regulatory questions, and Fang inflation modeling to them.

Scope: how the shop should FEEL, what to prioritize, what to skip.

---

## 1. Competitive landscape

**Duolingo Gems shop.** Three SKU archetypes only: streak freezes, hearts refills, timed XP boosters. Modal carousel surfaced contextually (when you lose hearts, after a lesson). Average free user buys 0 things; whales buy streak freezes weekly. STEAL: contextual surfacing beats a destination shop. AVOID: their shop is invisible if you don't fail, which caps discovery.

**Brilliant.org.** No shop. Single subscription. Lesson: if your product feels like a course, a shop feels cheap. We are NOT this product, but the warning is real for our Academia surface.

**Quizlet / Khan / Kahoot.** Subscription only, no cosmetics. They never built a second loop. Their engagement caps at "did you study today." We have a second loop (Fangs). Lesson: don't abandon the moat.

**Roblox Robux.** Dual currency, UGC marketplace, cosmetics as identity. Whales drive 70%+ of revenue. STEAL: cosmetics tied to social visibility (profile, leaderboard, Arena pre-game lobby). AVOID: UGC marketplace (moderation nightmare, not our stage).

**Mistplay.** Closest cash-out cousin. Users earn "units" by playing partner games, redeem for gift cards. Lesson: once cash-out is real, the shop COLLAPSES unless shop items feel like better value than cash. Their retention drops the moment users cash out for the first time. Read this twice.

**Mobile casual (Subway Surfers, Monopoly Go).** Battle pass + cosmetic skins + consumables (revives, key skips). Battle pass is the single highest-LTV mechanic in mobile gaming. STEAL: seasonal cadence. AVOID: pay-to-win consumables that warp competition.

---

## 2. Lionade shop personas

**Casual free user.** Loves the streak, won't subscribe. Buys 1-2 cosmetics/year if priced under a coffee. Top SKUs: profile frame, name color, streak shield. Annual LTV: $3-7.

**Fang grinder (free).** Earns 500+ Fangs/day, never pays. The whole point is "I earned this." Top SKUs: legendary Fang-priced cosmetics, rare frames, time-gated badges, Arena ghost-replay skins. Annual revenue: $0 direct, but they ARE the social proof whales pay to flex against. They retain other users.

**Pro / Platinum subscriber.** Already paying. Won't impulse-buy a $0.99 frame. WILL buy a $4.99 "AP Calc Mastery Pack" or a $9.99 season pass. Top SKUs: premium decks, exam packs, season pass, exclusive Pro-tier cosmetics. Annual LTV beyond sub: $15-30.

**Functional student.** Showed up because of an exam. Buys Mastery hint packs, extra Ninny generations, streak freeze the night before a test. Utility, not status. Top SKUs: hint pack, retry token, exam-specific deck. Annual LTV: $5-15, concentrated in 2-3 weeks.

**Whale (top 1%).** Buys $20-50 Fang packs to flex. Owns every legendary. Drives ~50% of IAP. Top SKUs: legendary cosmetics, animated frames, season pass, custom name effects. Annual LTV: $150-400.

---

## 3. Shop UX recommendations

**Layout.** Two surfaces, not one. (a) Destination shop at `/shop` = full grid with tabs (already exists). (b) Contextual offers = Duolingo-style modal that fires AFTER a loss, AFTER a streak save, BEFORE Arena queue. Contextual converts 5-10x destination.

**Featured carousel on dashboard.** Single hero card, rotates weekly. Mix: 1 cosmetic-of-the-week, 1 utility item, 1 limited drop. Already have `DailySpinHero` real estate to extend.

**Pricing display.** Show Fang price as primary; dollar price as secondary if dual-priced. Add "Save 1,200 Fangs" framing when dollar path is cheaper (rare). Never lead with dollars on cosmetics. DO lead with dollars on Fang packs themselves (obviously).

**Empty state.** New free user lands on a "Starter Pack" tile: pick ONE free cosmetic (frame, color, or banner). Cost: 0 Fangs, one-time. This trains the gesture of "claim something from the shop" within session 1. Conversion to second purchase jumps when the first action is frictionless.

**Notification surfaces.** Streak shield reminder at day 6 of streak (one push, not a daily nag). Low-Fang nudge ONLY after a failed buy attempt (don't dunk on broke users unprompted). Cosmetic-of-the-week push: 1x/week max. Social proof inline ("847 students bought this week") on shop tiles, not in push.

**Returning-user retention.** Weekly cosmetic reset (Mon 12pm local). Limited-edition seasonal drops (Halloween skull frame, summer beach background) that genuinely leave the shop. Never re-list seasonals; this is the only FOMO that isn't scummy because the reward is visual flex, not gameplay advantage.

---

## 4. Tier-gated vs. open

- **Pro+ exclusive cosmetics:** yes. 3-5 SKUs that ONLY Pro subscribers can buy (with Fangs OR dollars). Drives sub conversion via FOMO. Show these GRAYED OUT to free users with a "Pro" badge, not hidden. Visible aspiration converts.
- **Pro+ discount on Fang prices:** yes, 15% off all cosmetics. Cheaper than a free month, real perceived value. Reinforces sub retention.
- **Dollar-only items for free users:** avoid. If a free user wants to spend dollars, route them to Fang packs or the sub, not à la carte cosmetics. Keeps the "real money = Pro" mental model clean.

---

## 5. Cash-out's product impact on the shop

If Fangs become real money:

- **Hoarding behavior.** Users stop spending on cosmetics. Shop revenue craters unless cosmetics feel like a better deal than cash. Mistplay confirms this.
- **Cosmetics must become status flexes** users CAN'T get any other way. If a $5 frame is "I could've cashed this out for $4," nobody buys. If it's "this frame only existed for 7 days in Spring 2026," whales buy regardless.
- **Sink ratio.** Defer the exact number to economy, but the product rule: every legendary cosmetic should feel like 2-3x the perceived value of its cash-out equivalent. Use scarcity, animation, exclusivity to inflate perceived value without inflating cost.
- **Lifetime cosmetic spend milestone:** YES. Track per-user "Fangs spent on shop" lifetime. Milestones at 10k / 50k / 100k Fangs spent unlock exclusive collector badges (not buyable, not cash-out-able). This is the single best counter-pressure to cash-out hoarding.

---

## 6. Battle pass

**Recommendation: build it, but call it a Season Pass and tie it to STUDY milestones, not play time.**

Free track: 30 tiers unlocked by hitting study goals (minutes studied, decks completed, Arena wins). Premium track ($9.99/season, 8 weeks): same tiers, better cosmetics + a Fang bonus + 1 exam pack.

Why it works for EDU: progress is already the core loop. The pass just visualizes it. Duolingo Friends Quests proved learners accept gamification IF the goal is "you studied" not "you played." Genshin/Fortnite are the cosmetic-cadence model.

Risk: "too gamey" criticism from parents/schools. Mitigate by making the free track meaningful (cosmetics, not just XP boost) and naming it "Semester Pass" or "Study Season" instead of "Battle Pass."

This is the single highest-LTV mechanic available to us. Recurring 8-week revenue beats one-shot SKU sales by ~4x.

---

## 7. Recommended V1 launch (2-3 weeks)

**5-10 new SKUs:**

1. Streak Shield (consumable, dual price) — already validated mechanic
2. Mastery Hint Pack — 5 hints for a Mastery Mode session (utility, functional student)
3. Extra Ninny Gen Pack — 10 extra AI generations (Pro-tier upsell)
4. Animated "Lion Mane" profile frame (legendary, Fang OR dollar)
5. "First Drop" Spring 2026 banner (limited, leaves shop in 30 days)
6. Name color: Rainbow Gradient (Pro exclusive)
7. Arena Ghost Skin: Neon (cosmetic, Fang-only, Fang grinder bait)
8. AP Calc Mastery Deck (dollar-only, functional student)
9. Starter Pack tile (free first cosmetic claim, new-user only)
10. Lifetime Collector Badge tier 1 (unlocked at 10k Fangs spent)

**UI surface change:** Featured carousel on dashboard, slot above Daily Drill. Rotates weekly. One hero tile + two secondary tiles.

**Push surface:** Weekly "New this week" push, Tuesday 4pm local. Single push, batched, one tap to shop.

Hand off: dev-frontend + dev-backend for SKU plumbing, design-ui-ux for carousel, design-copywriter for SKU names (no dashes), data-economist for pricing, vp-business for legal sign-off on limited drops.
