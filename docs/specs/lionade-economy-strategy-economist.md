# Lionade Fang Economy + Shop Catalog Strategy
**Owner:** data-economist
**Date:** 2026-06-02
**Status:** V1 proposal for shop expansion + cash-out groundwork

---

## 1. Current faucet/sink audit

### Faucets (Fangs IN, base values before plan multiplier 1.0x / 1.5x / 2.0x)

| Source | Base grant | Frequency | Notes |
|---|---|---|---|
| Quiz completion (save-quiz-results) | ~100/quiz | 3-8/day engaged | 10/correct, difficulty scaled |
| Ninny session reward (complete) | 5-25/session | 1-4/day | 40% floor + 60% accuracy |
| Daily login bonus | 20-150 (escalating) | 1/day | Streak-tiered |
| Daily drill complete | 50-150 | 1/day | One-shot |
| Mission claims | 30-200 each | 3-5/day | Daily + weekly buckets |
| Bounty claims | 50-500 | 1-3/day | Cap-gated |
| Quiz streak bonus | +50/3 quizzes in 60min | up to 2/day | Anti-grind capped |
| Spin/roll | 10-500 | 1/day | RNG, mean ~80 |
| Mini-games reward | 10-60/game | 3-6/day | Per-game daily cap |
| Duel/Arena/Competitive win | 2x wager | variable | Zero-sum, not net new |
| Focus-session reward | 10-40 | 1-2/day | Timed study |

### Sinks (Fangs OUT)

| Sink | Cost | Frequency |
|---|---|---|
| Ninny generation (mode-based) | 200-1000 | 1-3/day power users |
| Ninny mode unlock | 200-600 one-time | rare |
| Shop cosmetics (frames/names/banners) | 15-750 | one-time |
| Shop boosters (consumable) | 40-200 | low (under-converted) |
| Daily bet stakes | 50-500 wager | 1/day |
| Abandon penalty | 50 | rare |
| Streak revive | 200-500 | rare |

### Net daily Fang flow (engaged user estimate)

- **Free (1.0x):** Earn ~700-900/day. Spend ~200-400/day (most never visit shop). **Net +400-600/day.**
- **Pro (1.5x):** Earn ~1,100-1,400/day. Spend ~400-700/day (Ninny power user). **Net +600-900/day.**
- **Platinum (2.0x):** Earn ~1,500-1,900/day. Spend ~500-900/day. **Net +900-1,200/day.**

**Diagnosis:** All three tiers are net-positive. Engaged users accumulate ~20k-35k Fangs/month with nothing compelling to spend on past the initial cosmetic haul. This is the "Robux problem" pre-cash-out: Fangs are perceived as worthless because the marginal Fang buys nothing the user wants.

---

## 2. Existing shop SKU inventory

From `app/shop/page.tsx`:

- **Frames (5):** 25-500 Fangs (Electric Blue → Golden Lion)
- **Name colors (4):** 20-450 Fangs (Ice Blue → Aurora)
- **Banners (4):** 15-750 Fangs (Starter → Legend)
- **Boosters (8):** 40-200 Fangs (Time Warp → Double Down)
- **Premium-USD cosmetics (~9):** $0.99-$4.99 (Phoenix Rising, Holo Name, etc.)

**Total: ~21 Fang SKUs, ~9 USD SKUs.** A maxed-out Free user can buy every cosmetic for ~2,700 Fangs total — roughly 3-4 days of earn. After day 4, they're cosmetically saturated and have no sink. The shop is the bottleneck of the economy.

---

## 3. New shop SKU brainstorm (28 ideas)

### Cosmetics — pure Fang sinks, infinite supply, zero real-world value

1. **Avatar Aura Pack** — animated glow ring around avatar (10 variants). 200-400 Fangs each. One-time.
2. **Leaderboard Medal Skins** — replace default rank icon with custom (gold tooth, lion paw, fang skull). 150-300 Fangs. One-time.
3. **Profile Flair Stickers** — small icon next to username (flame, crown, snowflake). 75-150 Fangs. One-time.
4. **Quiz-result Confetti Skin** — change the win-screen particle effect (gold coins, stars, fangs). 250 Fangs. One-time.
5. **Ninny Voice Skin** — alternate Ninny personality copy (Brit, Sassy, Chill, Drill Sergeant). 500-1000 Fangs. One-time.
6. **Study Music Skin Pack** — 4 ambient soundscapes for focus sessions (rain, lofi, forest, deep space). 300 Fangs/pack. One-time.
7. **Victory Animation Pack** — replace default quiz-completion screen animation (slam dunk, fireworks, rocket). 400 Fangs each. One-time.
8. **Banner Background Pack S2** — 6 new banners themed to seasons. 100-500 Fangs.
9. **Username Font Pack** — alternate font for your name on leaderboards (serif, gothic, retro pixel). 250 Fangs. One-time.
10. **Chat Bubble Skin** (party games) — color/shape variants for your messages. 100-200 Fangs. One-time.

### Consumables — one-time use, dual Fang OR USD

11. **Streak Shield 3-pack** — 3 missed-day saves. 400 Fangs / $0.99. Buy ~monthly.
12. **Daily Drill Skip** — auto-claim today's drill at average score. 100 Fangs / $0.49. Buy ~weekly.
13. **Mastery Hint Token** — reveal one wrong answer in any Mastery question. 50 Fangs each. Buy daily.
14. **Sketchy Redraw Token** — re-roll your word in Sketchy Subjects. 75 Fangs. Buy 1-2x/session.
15. **Trust Issues Card Peek** — see opponent's hidden card once per match. 100 Fangs. Buy occasionally.
16. **Quiz Time Extender 5-pack** — +30s on next 5 questions. 150 Fangs / $0.49.
17. **Bet Stake Booster** — multiply your daily-bet payout by 1.5x for one bet. 200 Fangs / $0.99.

### Utility — recurring benefit, Fang-priced over time, USD-priced one-shot

18. **Premium Question Bank Rental (7 days)** — subject-specific (MCAT, SAT Bio, AWS Sec). 800 Fangs / $2.99 per bank.
19. **Advanced Flashcard Deck** — curated 100-card deck on a topic. 500 Fangs / $1.99. Permanent.
20. **Focus Music Premium Pack** — 8 cinematic study tracks. 600 Fangs / $1.99. Permanent.
21. **Sketchy Premium Word Pack** — 200 spicier prompt words. 400 Fangs / $0.99. Permanent.

### Status / scarcity — limited drops

22. **Weekly Limited Cosmetic** — one rotating frame/banner each Monday, available 7 days only. 600-1500 Fangs.
23. **Founder Badge** — for accounts created before 2026-12-31. Free/auto-granted, not buyable. Pure flex.
24. **Milestone Badges** — "100-day Streak", "1M Lifetime Fangs", "1000 Quizzes". 0 Fangs (auto), but display unlock costs 100 Fangs.
25. **Seasonal Banner Drop** — themed banner each season (4/year). 800 Fangs, expires in shop after 30 days.

### Functional cheats — flag with caution

26. **2x Fang Multiplier Rental (6h)** — 1500 Fangs / $0.99. **SKIP — combined with cash-out this becomes pay-to-print and Apple will sniff it.**
27. **Question Skip Token** — skip a quiz question with no penalty. 100 Fangs. **Caution — undermines quiz integrity for ladders. Allow in casual, BAN in Arena/Competitive.**

### Pro-only premium exclusives — gated by subscription tier, not just discount

28. **Pro-Tier Frame Vault** — 6 exclusive frames only Pro+ can purchase (any price). Gives Pro a non-multiplier reason to stay subscribed.

---

## 4. Cash-out impact on the economy

Shipping a Fang cash-out at any ratio (even 100,000 Fangs = $1) fundamentally changes user psychology:

- **Hoarding replaces spending.** Once Fangs are convertible, sinking 500 Fangs on a frame is a $0.005 expense, not a free reward. The shop is now competing with cash.
- **Faucet abuse becomes profitable.** Anyone who can grind 5k Fangs/day for $0.05 will. Bot farms appear.
- **Whales become extraction targets.** Top 1% can rack up multi-million Fang balances quickly via Pro 2x + grinding.
- **Pro/Platinum + cash-out = pay-to-extract.** A Platinum subscriber paying $14.99/mo who earns 2x Fangs that cash out at $20/mo is net-extracting. Apple will reject this under IAP rules.

### Recommendations (pre-cash-out hardening)

(a) **Target Fang-spend ratio: users must sink >=60% of lifetime earned Fangs into in-app shop/utility BEFORE any cash-out unlocks.** Cash-out only operates on the remaining 40%. This forces the shop to actually be desirable.

(b) **Anti-hoarding decay:** Fangs decay 5%/month after 90 days of zero shop activity. Resets on any purchase. Keeps the velocity up.

(c) **Tiered earning curve:** Daily earn caps soft-throttle past 1500/day (free), 2500/day (Pro), 3500/day (Platinum). After the cap, earn rate drops to 25% of base. Slows whales without starving casuals.

(d) **Cash-out cap per user per month:** max $5 cash-out/month regardless of balance. Prevents extraction abuse and keeps Apple comfortable.

(e) **KYC at $10 lifetime cash-out.** Required by FinCEN/state money-transmitter rules anyway. Coordinate with business-legal-compliance.

(f) **Cash-out only operates on EARNED Fangs, not GRANTED Fangs.** Login bonuses, missions, daily drill = ineligible for cash-out. Quiz/Ninny/Arena (skill-demonstrated) = eligible. This is the cleanest defense against grind-bots.

---

## 5. Top 10 V1 SKUs to ship (ranked by ROI)

1. **Streak Shield 3-pack** (consumable, 400 Fangs / $0.99) — proven hook, retention saver, dual-priced.
2. **Avatar Aura Pack** (cosmetic, 200-400 Fangs) — 10 SKUs from one art template, massive Fang sink.
3. **Ninny Voice Skin** (cosmetic, 500-1000 Fangs) — high perceived value, copy-only build (no new art).
4. **Mastery Hint Token** (consumable, 50 Fangs) — micro-sink, used daily, integrates with shipped Mastery flow.
5. **Pro-Tier Frame Vault** (gated cosmetic, 300-600 Fangs) — non-multiplier reason to upgrade.
6. **Weekly Limited Cosmetic** (status drop, 600-1500 Fangs) — recurring drop schedule = recurring sink.
7. **Daily Drill Skip** (consumable, 100 Fangs / $0.49) — convenience play for busy users.
8. **Victory Animation Pack** (cosmetic, 400 Fangs) — high-visibility flex, particle reuse.
9. **Premium Question Bank Rental** (utility, 800 Fangs / $2.99) — real study value, Pro/Platinum bridge to standalone purchase.
10. **Focus Music Premium Pack** (utility, 600 Fangs / $1.99) — sticky engagement hook, licensable.

All 10 are <1 week of build each, none introduce gambling mechanics, and together they roughly TRIPLE the existing sink capacity which is exactly what's needed before cash-out.

