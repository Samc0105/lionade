# LIONADE — Master Plan

**Last updated:** 2026-05-01
**Domain:** getlionade.com
**Status:** Private beta. Web app live at getlionade.com. iOS app Phase 0–6c shipped (awaiting EAS dev build). No paid users yet.

> This is the strategic master doc — what we have, what it earns, what it costs, what's next, and what we could build. For the marketing pitch, see `LIONADE_PRESENTATION.md`. For the dev/architecture reference, see `docs/LIONADE_CONTEXT.md`.

---

## Table of Contents

1. [What Lionade Is, In One Page](#1-what-lionade-is-in-one-page)
2. [The Three Pillars](#2-the-three-pillars)
3. [Complete Feature Inventory](#3-complete-feature-inventory)
4. [The Fangs Economy](#4-the-fangs-economy)
5. [Pricing & Plans](#5-pricing--plans)
6. [Revenue Streams](#6-revenue-streams)
7. [Cost Structure](#7-cost-structure)
8. [Financial Projections](#8-financial-projections)
9. [Near-Term Roadmap (Q2–Q3 2026)](#9-near-term-roadmap-q2q3-2026)
10. [Mid-Term Roadmap (Q4 2026 – Q2 2027)](#10-mid-term-roadmap-q4-2026--q2-2027)
11. [Future Feature Ideas](#11-future-feature-ideas)
12. [Tech Stack & Infrastructure](#12-tech-stack--infrastructure)
13. [Risks & Open Questions](#13-risks--open-questions)

---

## 1. What Lionade Is, In One Page

**One-liner:** A study app that pays students for showing up.

**Tagline:** *Study Like It's Your Job.*

**Target user:** Gen Z students (middle school → college → self-taught). The "I should be studying but TikTok is right there" demographic.

**Core promise:** Every quiz, focus session, note, and streak earns **Fangs** — an in-app currency that unlocks cosmetics, perks, and (V2) real cash payouts.

**Why this works:** Studying is a habit problem dressed up as a content problem. Duolingo solved this for languages. Nobody has for general studying. We're building the loop: *show up → make progress → get rewarded → come back tomorrow.*

**What's actually shipped (web app):**

- Authenticated platform with email/password + Google OAuth
- 8 subject categories, AP exam prep (10 subjects), question bank seeded via JSON
- Daily Quiz (10 questions, 15s timer, anti-cheat server validation)
- Mastery Mode (chat-based AI tutor, BKT mastery tracking, AWS Sec Specialty pilot)
- Class Notebook (syllabus PDF parser → daily study plan, exam countdown, weighted grade tracker, auto-flashcards)
- Daily Drill, Daily Bet, Streak Revive, Clock-In Bonus
- 1v1 Duels + ELO-ranked Arena
- Compete tier ladder (Bronze → Legend, 9 tiers)
- Friends + DMs + leaderboards (weekly + ELO)
- Mini-games (Roardle, Blitz Sprint, Flashcards, Timeline Drop) with PDF-to-game generator
- Shop (Fangs cosmetics + boosters; Stripe wired for premium store)
- Profile system, badges, achievements, bounties, missions
- Real-time notifications, focus music, focus lock-in (Pomodoro), quick-note shortcut
- 3-tier subscription pricing page (Free / Pro $6.99/mo / Platinum $14.99/mo)

**iOS app:** Expo + EAS pipeline through Phase 6c. Apple Team ID set. Awaiting dev-client build.

---

## 2. The Three Pillars

Every feature falls under one of three pillars. If a new idea doesn't, we don't build it.

| Pillar | Question it answers | Surfaces |
|--------|--------------------|----------|
| **Learn** | "How do I get better at this?" | Daily Quiz, Mastery Mode, Class Notebook, AP prep, learning paths |
| **Compete** | "How do I prove it?" | Duels, Arena, leaderboards, tier ladder, tournaments |
| **Grow** | "What's my reward for showing up?" | Fangs economy, streaks, badges, bounties, shop, cosmetics, future cash payouts |

---

## 3. Complete Feature Inventory

### 3.1 Auth & Onboarding

| Feature | Status | Notes |
|---|---|---|
| Email/password + Google OAuth | Live | Brute-force lockout (5 fails / 15 min) |
| 3-step signup wizard | Live | Education level, study goal, referral source |
| 4-step new-user onboarding | Live | Subjects, daily target, avatar, intro tour |
| 2-hour inactivity auto-logout | Live | LocalStorage timestamp |
| Self-healing profile rows | Live | Creates fallback profile if signup trigger missed |

### 3.2 Daily Habit Loop

| Feature | Status | Notes |
|---|---|---|
| Daily Quiz | Live | 10 questions, 15s/q, server-side anti-cheat |
| Daily Drill | Live | Quick warmup quiz, 1 per day |
| Daily Clock In | Live | 24-hour rolling cooldown (was UTC reset), Fangs reward |
| Daily Bet | Live | Wager Fangs on quiz score (7/8/9/10 = 1.5x/2x/3x/5x) |
| Streak system | Live | Increments per calendar day, fire animation at 7+ |
| Streak Revive | Live | 24h Snapchat-style post-hoc restore via Fangs or $0.99 |
| Login bonus (legacy) | Live | One-time per session |

### 3.3 Learn Pillar

| Feature | Status | Notes |
|---|---|---|
| 8 subject categories | Live | Math, Science, Languages, Humanities, Tech, Cloud/IT, Finance, Test Prep |
| AP Exam prep | Live | 10 AP subjects, best-score tracking |
| Learning paths | Live | 4 subjects (Algebra, Bio, US History, Chem), star system |
| Practice Sets | Coming | Curated timed batches |
| **Mastery Mode** | Live | Chat-first AI tutor. Topic-driven Socratic teaching + adaptive quizzing. BKT progress tracking. Pilot: AWS Security Specialty. |
| **Class Notebook v1** | Live | Per-class hub: syllabus PDF parser, daily study plan, exam countdown, weighted grade tracker, "needed-on-final" calculator, notes, auto-flashcards via Ninny |
| Spaced-repetition flashcards | Live | Auto-generated from notes ≥80 chars |

### 3.4 Compete Pillar

| Feature | Status | Notes |
|---|---|---|
| 1v1 Duels (casual) | Live | Subject + 10 questions + Fangs wager. Currently simulated opponents (68% accuracy). |
| Arena (ranked) | Live | ELO matchmaking (~1200 start), wagers 10/25/50/100, real-time via Supabase |
| Direct challenges | Live | 5-min expiry |
| Compete tier ladder | Live | Bronze → Silver → Gold → Platinum → Diamond → Onyx → Ruby → Emerald → Legend (9 tiers, win-based) |
| Weekly leaderboard | Live | Coins-this-week ranking, podium UI |
| ELO leaderboard | Live | Top 200, lifetime |
| Weekly Tournaments | Coming | Bracket + prize pool placeholder |

### 3.5 Grow Pillar (Economy & Rewards)

| Feature | Status | Notes |
|---|---|---|
| Fangs (in-app currency) | Live | See section 4 |
| XP & Leveling | Live | 100 levels, ~5 years to max, progressive curve |
| Badges + Achievements | Live | Common/Rare/Epic/Legendary; +100F bonus on unlock |
| Bounties | Live | Daily + weekly; auto-rotates |
| Daily Missions | Live | Multi-step tasks |
| Shop "The Lion's Den" | Live | Fangs side: avatar frames, name colors, banners (15-750F), boosters (75-200F). USD side wired to Stripe (not live). |
| Wallet / transaction log | Live | Full Fangs audit trail |

### 3.6 Social

| Feature | Status | Notes |
|---|---|---|
| Friends (mutual follow) | Live | |
| Direct messaging | Live | |
| Live username search | Live | |
| Online presence | Live | Real-time via Supabase |
| Real-time notifications | Live | Bell icon, channel sub |
| Friend match feed | Live | |
| Study Groups | Future | |

### 3.7 Games

| Game | Status | Reward | Daily limit |
|---|---|---|---|
| Roardle | Live | 10–20F + bonus | 3 |
| Blitz Sprint | Live | correct × 2F | 5 |
| Flashcards | Live | %known × 15F | unlimited |
| Timeline Drop | Live | correct × 3F | 3 |

All games support **PDF upload** — drop a PDF and AI generates game content from it.

### 3.8 Productivity Tools (Floating UI)

| Feature | Status | Notes |
|---|---|---|
| Quick Note (Cmd+K) | Live | Lightweight modal anywhere; AI auto-files into right class |
| Focus Lock-In | Live | Sealed Pomodoro timer with Fangs reward |
| Focus Music | Live | 3 curated lo-fi stations |
| Idle-fade | Live | All floating buttons dim to 0.4 opacity when idle |

### 3.9 Profile, Settings, Polish

| Feature | Status | Notes |
|---|---|---|
| Profile page (overview/badges/stats/history) | Live | |
| DiceBear avatar system | Live | Currently default; custom avatar system was built then reverted per user direction |
| Username change | Live | One per 365 days |
| Settings: theme + font scaling + compact layout | Live | Dark default, light theme working |
| Light/dark theme | Live | |
| Mobile-responsive | Live | Bottom nav on small screens |
| Page transitions (framer-motion) | Live | 80ms enter, no exit |

### 3.10 Security & Infrastructure

| Feature | Status | Notes |
|---|---|---|
| Rate limiting middleware | Live | In-memory; needs Redis at scale |
| Input sanitization | Live | XSS, SQL injection, script tag detection |
| Security headers (CSP/HSTS/etc.) | Live | |
| Anti-cheat (server-side answer validation) | Live | Questions served without `correct_answer` |
| RLS on Supabase tables | Live | See `lib/migrations/RLS_RULES.md` |
| Brute-force account lockout | Live | 5 failures / 15 min |
| Storage RLS on syllabus bucket | Live | Migration 044 |

### 3.11 SEO & Marketing Surface

| Feature | Status | Notes |
|---|---|---|
| Landing page | Live | Coming-soon variant + full home page |
| About / Contact / Privacy / Terms | Live | |
| Demo page | Live | Public quiz demo, no login required |
| Sitemap + robots.txt | Live | |
| JSON-LD structured data | Live | Combats Google "lionade → lemonade" autocorrect |
| Multi-resolution favicon set | Live | 16/32/48/192/512 + apple-touch |
| Open Graph + Twitter cards | Live | 1200×630 OG image via CloudFront |

---

## 4. The Fangs Economy

Fangs are the lifeblood of the product loop. They're the reason students come back tomorrow.

### Earn Faucets

| Action | Reward | Frequency |
|---|---|---|
| Correct quiz answer | ~10F (1× easy / 1.5× medium / 2× hard) | Per question |
| Quiz completion | ~100F (10 questions) | Per quiz |
| Duel win | 2× wagered (winner: 750F, loser: 100F, tie: 200F) | Per duel |
| Arena win | Wager from loser | Per match |
| Daily Bet win | 1.5×–5× stake | Daily, optional |
| Bounty claim | 50–500F | Daily/weekly |
| Badge unlock | +100F | One-time per badge |
| Learning path stage | score×5 + stars×10 F | Per stage |
| Mini-game | 10–30F | Per play |
| Daily Clock In | varies | 1× per 24h |
| Focus Lock-In completion | varies | Per session |

### Spend Sinks

| Sink | Cost | Effect |
|---|---|---|
| Coin Rush 2× | 75F | 2× Fangs earnings, 1 quiz |
| XP Surge 2× | 75F | 2× XP, 1 quiz |
| Streak Shield (legacy) | 150F | (replaced by Streak Revive) |
| Streak Revive | varies | 24h post-hoc streak restore |
| Double Down | 200F | +2× wager cap |
| Brain Freeze / 50-50 | 125F | Eliminate 2 wrong options |
| Avatar frames | 25–500F | Cosmetic |
| Name colors | 20–450F | Cosmetic |
| Banners | 15–750F | Cosmetic |
| Bulk buy | -10% on 5× | Bulk discount |

### Plan Multipliers

Pro = 1.5× Fangs earn rate. Platinum = 2.0× Fangs earn rate. (`lib/mastery-plan.ts`)

This is the upgrade lever: Pro/Platinum users feel measurably faster progress on the same activity.

### Future: Cash Out

V2 goal (Dec 2026) — Fangs convert to real prizes / payouts. Planned conversion ratio TBD; the comparable benchmark is **Microsoft Rewards: ~1,000 points → $1**, so a similar 1,000F → $1 anchor is plausible. With our average earn rate (~100F per quiz, ~700F/week active user), a daily-active student would realistically earn $20–$40/year — meaningful but not abuse-prone.

---

## 5. Pricing & Plans

Source of truth: `lib/mastery-plan.ts`.

| Plan | Monthly | Annual | Annual / mo | Mastery exam targets | Fangs multiplier | Ads | Other |
|---|---|---|---|---|---|---|---|
| **Free** | $0 | $0 | $0 | 1 | 1.0× | Popup + background | Core experience |
| **Pro** | $6.99 | $69.99 | $5.83 | 3 | 1.5× | No popups | Most features |
| **Platinum** | $14.99 | $149.99 | $12.50 | 8 | 2.0× | None | Power users |

**Annual = ~2 months free** (standard SaaS value prop, encourages prepay).

**Stripe wiring:** Done. Not flipped to live. Going live is a business decision, not an engineering one.

---

## 6. Revenue Streams

We have **13 potential revenue streams** across 5 categories. Subscriptions are the headline; the rest are how we make the unit economics work.

### Category A — Subscriptions (Recurring SaaS)

**6.1 Pro / Platinum subscriptions** — Wired. Stripe integrated; live switch is a business call. Primary recurring revenue line.

**6.2 Family Plan** — Planned (§9.6). $19.99/mo for up to 4 kids. Covers ~30% margin uplift vs solo Platinum because parents churn less than students.

**6.3 Lionade for Teachers (B2B)** — Concept. $99/mo per classroom. Teacher dashboard, assignments, class leaderboards, FERPA-compliant. Even 100 paying teachers = $119K/yr. Schools have budget; consumer apps usually don't tap this.

**6.4 Battle Pass (Cosmetic Season)** — Planned. $4.99/mo recurring upgrade on top of any tier. Unlocks exclusive seasonal cosmetics, animated avatar frames, special name effects. Fortnite proved this works at massive scale; Duolingo is now testing similar with their Duolingo Max tier. Realistic uptake: ~5% of MAU at maturity.

### Category B — Advertising (The Underrated Lever)

This was undersold in my first pass. With a Gen-Z education audience, ads can be *substantial* — but only if we layer multiple networks.

**6.5 Display ads (Google AdSense + Meta Audience Network)**
- AdSense for desktop web; Meta Audience Network often pays higher CPM for the 13-22 demo
- Layered via header bidding (PubMatic, OpenX) — 20–40% CPM uplift over single-network
- Placements: passive sidebar banner, between-question interstitial (free tier only)
- Realistic blended RPM: **$3–$5 USD** at our demo + content quality
- Removed for Pro (popups) and Platinum (all)

**6.6 Mobile in-app ads (Google AdMob + Unity Ads + ironSource)**
- Native mobile app monetization. Mobile CPMs typically beat desktop by 30–50% for Gen-Z apps
- Placements: post-quiz interstitial, app-resume banner
- Realistic blended RPM: **$5–$8** on mobile

**6.7 Rewarded video ads — KEY OPPORTUNITY**
- "Watch a 30-second ad → earn 25 Fangs" or "Get a hint" or "Skip cooldown"
- Voluntary, so no Pro/Platinum pushback
- Highest-RPM ad format: **$8–$15 per 1000 views**
- Unity Ads, AppLovin MAX, ironSource — all support rewarded video
- Realistic engagement: 20% of MAU watches ~5 ads/month

**6.8 TikTok Audience Network**
- Perfect demographic match for our target user
- Lower fill rate than AdSense but very high CPM ($6–$10) when it fills
- Add as a tertiary network in the waterfall

**6.9 Direct sponsorships**
- Brands like Chegg, Notion, Grammarly, Khan Academy pay $5K–$50K for branded quiz integrations or sponsored study weeks
- "This week's productivity bounty sponsored by Notion — claim 250F + a 1-month Notion trial"
- Higher margin than programmatic ads (no ad-tech tax)

### Category C — Microtransactions (Snapchat-style)

**6.10 Streak Revive** — Wired. $0.99 to restore an expired streak. Pure emotional-leverage purchase.

**6.11 Premium cosmetics (one-shot IAPs)** — Wired. $1.99–$4.99 vanity purchases. ~96% gross margin (Stripe fee only).

**6.12 Gift cards** — Concept. Parents/grandparents buy $25/$50/$100 Fangs gift cards. Apple's gift-card line alone is $1.3B/yr. Holiday + birthday revenue spikes. Stripe Gift Card API is straightforward to wire.

**6.13 Premium content packs** — Concept. Pre-built study guides for SAT/ACT/MCAT/CFA/Bar at $9.99 each, or past AP exam packs at $4.99. One-time purchase, near-zero variable cost after authoring.

### Category D — Marketplace / Take Rates (V2/V3)

**6.14 Real cash payouts** — Planned (V2). Top performers earn real money from a monthly prize pool. Funded by a take rate on optional tournament entry fees + a portion of subscription revenue. Structure ≤10% of subscription gross + 15% take on tournament entry.

**6.15 Tutoring marketplace** — Planned (V3). Top users tutor lower users; Lionade takes 15–20% of session price. Pure-margin revenue (no AI cost, no inventory). Strongest users become our distribution.

**6.16 Tournament entry fees** — Planned. $5 entry, 64-player single-elim, $300 prize pool, 15% house take. Recurring weekly/monthly cadence.

### Category E — Affiliates & Adjacent

**6.17 Affiliate revenue (passive)**
- Amazon Associates: textbook recommendations in study material
- Coursera/edX/Skillshare affiliate signups
- Chegg/Course Hero referrals
- Calculator/equipment (TI-84, Apple Pencil) — back-to-school season spike
- Notion, Grammarly, ChatGPT Plus referral programs
- Realistic: **$0.10–$0.20 per MAU per month** at maturity

**6.18 Lionade Merch** — Concept. Print-on-demand hoodies, water bottles, stickers via Printful (no inventory risk, 30–40% margin). Brand-building bonus.

**6.19 Anonymized data insights (B2B)** — Concept. Curriculum publishers + test-prep companies pay for "what concepts are students struggling with at scale." High-margin, opt-in only, requires legal/privacy framework.

### Quick Comparison: Margin Per Stream

| Stream | Variable cost | Gross margin |
|---|---|---|
| Subscriptions | AI + Stripe fee | 35–60% |
| Family plan | Same | 50–65% |
| Teacher edition | Same | 70%+ (lower AI per student vs. consumer) |
| Battle pass | Stripe fee only | 95% |
| Display ads | Ad-tech tax (~30%) | 70% |
| Rewarded video | Ad-tech tax | 70% |
| Direct sponsorships | None | 95%+ |
| Streak Revive / cosmetics | Stripe fee | 92% |
| Gift cards | Stripe fee + breakage | 90%+ |
| Cash payouts (take) | Stripe fee | 85% |
| Tutoring marketplace (take) | Stripe Connect fee | 85% |
| Affiliate | None | 100% |
| Merch | Printful unit cost | 30–40% |

**Key insight: every stream other than subscriptions has 70%+ gross margin.** Once we diversify off "just subscriptions," the unit economics improve dramatically.

---

## 7. Cost Structure

### 7.1 Variable Costs (Per User Per Month)

| Cost | Free user | Pro user | Platinum user | Source |
|---|---|---|---|---|
| AI (OpenAI/Anthropic/Gemini) | ~$0.50 | ~$3.00 | ~$5.00 | `lib/mastery-plan.ts` notes |
| Supabase (DB + auth + realtime) | ~$0.05 | ~$0.10 | ~$0.15 | Pro+ users do more reads |
| Vercel (hosting + bandwidth) | ~$0.05 | ~$0.05 | ~$0.05 | Mostly fixed |
| CloudFront CDN | ~$0.01 | ~$0.01 | ~$0.01 | Image bandwidth |
| Resend (transactional email) | ~$0.005 | ~$0.005 | ~$0.005 | <0.01¢ per email |
| Stripe fees (per transaction) | $0 | 2.9% + $0.30 | 2.9% + $0.30 | Flat |
| **Total variable** | **~$0.62** | **~$3.66** (after Stripe) | **~$5.66** (after Stripe) | |

**Stripe fee math:**
- Pro monthly $6.99 → Stripe takes ~$0.50 → net $6.49
- Pro annual $69.99 → Stripe takes ~$2.33 → net $67.66 (much better)
- Platinum monthly $14.99 → Stripe takes ~$0.73 → net $14.26
- Platinum annual $149.99 → Stripe takes ~$4.65 → net $145.34

### 7.2 Fixed Costs (Per Month)

| Cost | Estimate | Notes |
|---|---|---|
| Domain renewals | ~$2 | getlionade.com |
| Apple Developer | ~$8 | $99/yr ÷ 12 |
| Google Play Developer | ~$2 | $25 one-time amortized |
| Supabase base tier | $0–$25 | Free tier sufficient until ~10K users |
| Vercel base tier | $0–$20 | Hobby → Pro at scale |
| Monitoring/error tracking | ~$0–$26 | Sentry free tier |
| **Fixed monthly base** | **~$15–$85** | At small scale |

### 7.3 Margin Per User

| Plan | Net revenue (annual cycle) | Variable cost | Gross margin |
|---|---|---|---|
| Free | $0 | $0.62/mo = $7.44/yr | **-$7.44/yr** (loss leader) |
| Pro annual | $67.66/yr | $3.66 × 12 = $43.92 | **+$23.74/yr (35% margin)** |
| Platinum annual | $145.34/yr | $5.66 × 12 = $67.92 | **+$77.42/yr (53% margin)** |
| Pro monthly | $77.88/yr ($6.49 × 12) | $43.92 | **+$33.96/yr (44% margin)** |
| Platinum monthly | $171.12/yr ($14.26 × 12) | $67.92 | **+$103.20/yr (60% margin)** |

**Key insight:** Free users cost ~$7/yr in AI alone. We need a 1.6% conversion rate to Pro annual just to break even on the free tier (1 paying Pro pays for 3 free users). Conversion rate above 5% = healthy.

---

## 8. Financial Projections

> **These are projections based on shipped features + comparable Gen-Z app benchmarks. Not promises.** Update assumptions as real data comes in.

### 8.1 The First Pass Was Too Pessimistic — Here's What Changed

The original projections in this doc showed every scale losing money. The team is right to push back. Three errors in the first model:

1. **Conversion math was applied to DAU instead of MAU.** Industry-standard "% paid" is measured against MAU. MAU is typically 2.5–3× DAU for habit apps, so true paying users are ~2.5× higher than I showed.
2. **Free-tier AI cost was modeled ungated** ($0.50/free/mo). With sensible product gating (Mastery Mode = Pro only, syllabus parser = 3 free, free chat routes to gpt-4o-mini exclusively), free AI cost drops to ≤$0.20/mo. **This single change flips every scenario.**
3. **Only 4 revenue streams modeled** — subscriptions, ads, Streak Revive, cosmetics. We have 13+ realistic streams (see §6). Battle pass alone could rival ad revenue at scale.

The tables below model the **realistic with AI controls + full ad stack + battle pass + affiliate** scenario.

### 8.2 Updated Assumptions

| Assumption | Conservative | Base | Optimistic |
|---|---|---|---|
| MAU / DAU ratio | 2.5× | 2.8× | 3.0× |
| Conversion to paid | 3% of MAU | 5% of MAU | 8% of MAU |
| Pro / Platinum split | 75 / 25 | 70 / 30 | 65 / 35 |
| Annual prepay share | 30% | 45% | 60% |
| Free AI cost / user | $0.30/mo | $0.20/mo | $0.10/mo |
| Display ad RPM (web) | $2.50 | $4 | $6 |
| Mobile ad RPM | $4 | $6 | $9 |
| Rewarded video uptake | 10% MAU × 3 ads | 20% × 5 ads | 30% × 7 ads |
| Battle pass uptake | 2% MAU | 5% MAU | 8% MAU |
| Affiliate $/MAU/mo | $0.05 | $0.12 | $0.20 |
| Streak Revive uptake | 1% MAU | 2% MAU | 4% MAU |
| Cosmetic IAP / MAU/mo | 0.3% × $4 | 0.5% × $4 | 1% × $5 |
| Gift card $/MAU/mo | $0.03 | $0.07 | $0.15 |

### 8.3 Scenarios at Different DAU

#### 1,000 DAU (early launch — Q3 2026)

| Stream | Conservative | Base | Optimistic |
|---|---|---|---|
| Subscriptions | $580 | $1,095 | $2,005 |
| Battle pass | $50 | $625 | $1,200 |
| Display + mobile ads | $290 | $475 | $810 |
| Rewarded video ads | $75 | $200 | $480 |
| Affiliate | $125 | $300 | $600 |
| Streak Revive | $25 | $50 | $120 |
| Cosmetics | $30 | $50 | $150 |
| Gift cards | $75 | $175 | $450 |
| **Gross monthly** | **$1,250** | **$2,970** | **$5,815** |
| Variable + Stripe + Infra | -$900 | -$1,225 | -$1,500 |
| Fixed | -$100 | -$100 | -$100 |
| **Net monthly** | **+$250** | **+$1,645** | **+$4,215** |

#### 10,000 DAU (V1 public — late 2026)

| Stream | Conservative | Base | Optimistic |
|---|---|---|---|
| Subscriptions | $5,800 | $10,950 | $20,050 |
| Battle pass | $500 | $6,250 | $12,000 |
| Display + mobile ads | $2,900 | $4,750 | $8,100 |
| Rewarded video ads | $750 | $2,000 | $4,800 |
| Affiliate | $1,250 | $3,000 | $6,000 |
| Streak Revive | $250 | $495 | $1,200 |
| Cosmetics | $300 | $500 | $1,500 |
| Gift cards | $750 | $1,750 | $4,500 |
| **Gross monthly** | **$12,500** | **$29,695** | **$58,150** |
| Variable + Stripe + Infra | -$8,500 | -$11,950 | -$15,500 |
| Fixed | -$500 | -$500 | -$500 |
| **Net monthly** | **+$3,500** | **+$17,245** | **+$42,150** |

#### 50,000 DAU (V2 milestone — mid 2027)

| Stream | Conservative | Base | Optimistic |
|---|---|---|---|
| Subscriptions | $29,000 | $54,750 | $100,250 |
| Battle pass | $2,500 | $31,250 | $60,000 |
| Display + mobile ads | $14,500 | $23,750 | $40,500 |
| Rewarded video ads | $3,750 | $10,000 | $24,000 |
| Affiliate | $6,250 | $15,000 | $30,000 |
| Streak Revive | $1,250 | $2,475 | $6,000 |
| Cosmetics | $1,500 | $2,500 | $7,500 |
| Gift cards | $3,750 | $8,750 | $22,500 |
| Tournament take + cash payouts (V2) | $0 | $5,000 | $15,000 |
| **Gross monthly** | **$62,500** | **$153,475** | **$305,750** |
| Variable + Stripe + Infra | -$40,000 | -$54,000 | -$72,000 |
| Fixed | -$1,500 | -$1,500 | -$1,500 |
| **Net monthly** | **+$21,000** | **+$97,975** | **+$232,250** |

#### 100,000 DAU (full vision — 2027–2028)

| Stream | Conservative | Base | Optimistic |
|---|---|---|---|
| Subscriptions | $58,000 | $109,500 | $200,500 |
| Battle pass | $5,000 | $62,500 | $120,000 |
| Display + mobile ads | $29,000 | $47,500 | $81,000 |
| Rewarded video ads | $7,500 | $20,000 | $48,000 |
| Affiliate | $12,500 | $30,000 | $60,000 |
| Streak Revive | $2,500 | $4,950 | $12,000 |
| Cosmetics | $3,000 | $5,000 | $15,000 |
| Gift cards | $7,500 | $17,500 | $45,000 |
| Tournament + cash payouts | $0 | $15,000 | $45,000 |
| Tutoring marketplace (V3) | $0 | $10,000 | $40,000 |
| Teacher edition (B2B) | $0 | $10,000 | $30,000 |
| Direct sponsorships | $0 | $5,000 | $25,000 |
| **Gross monthly** | **$125,000** | **$336,950** | **$721,500** |
| Variable + Stripe + Infra | -$80,000 | -$108,000 | -$144,000 |
| Fixed | -$3,000 | -$3,000 | -$3,000 |
| **Net monthly** | **+$42,000** | **+$225,950** | **+$574,500** |
| **Net annual** | **+$504K** | **+$2.7M** | **+$6.9M** |

### 8.4 The Levers That Make This Work

The story across all four scales: **profitable from day one IF four levers stay in place.**

1. **Free-tier AI is gated.** Mastery Mode is Pro+. Syllabus parser = 3 lifetime parses on free. Free chat routes to gpt-4o-mini only. **This is the difference between profitable and bleeding.**

2. **Ads are layered.** Single-network AdSense gets you $2 RPM. Layered (AdSense + AdMob + Meta + TikTok + rewarded video) gets $5–$8 blended. That's a 2.5–4× multiplier on the same eyeballs.

3. **Battle pass ships.** $4.99/mo cosmetic season is high-margin recurring revenue with proven Gen-Z appetite (Fortnite, Snapchat+, Duolingo Max). Even 5% uptake adds 50–80% to subscription revenue.

4. **Conversion holds at ≥5%.** Below 3%, the model gets shaky. Above 5%, it's strong. Levers: aggressive paywall on Mastery + Class Notebook (the AI features), free trials on Pro, founding-member discounts, friction at "I want a 4th class" → upgrade.

If two of these slip, we're back to the original pessimistic scenario. If all four hold, **break-even comes at <1,000 DAU** in the base case.

### 8.5 What This Looks Like at Real Comparable Scale

For context — actual Gen-Z app DAUs in roughly the same lane:

| App | DAU (approx) | Monetization mix |
|---|---|---|
| Duolingo | 30M+ | Subs + ads + cosmetics + family plan |
| Quizlet | 50M+ MAU | Subs + ads (light) |
| Photomath | 10M+ MAU | Subs |
| Brainly | 50M+ MAU | Subs + ads |
| Snapchat (study/chat overlap) | 414M | Ads + Snap+ subs + microtransactions |

Reaching even 100K DAU is ambitious but realistic — Lionade only needs ~0.3% of the US student population (~50M K-12 + ~20M post-secondary) to hit it.

---

## 9. Near-Term Roadmap (Q2–Q3 2026)

Sequenced. Each item should ship in 1–4 weeks.

### 9.1 iOS App — Public Beta (TestFlight)

iOS Phases 0–6c done; awaiting EAS dev-client build. Once that builds: TestFlight invite, friends-and-family beta, App Store submission. **Critical** — unlocks half the addressable market.

### 9.2 Android App

Same Expo codebase. EAS already configured for both targets. Should ship within 2 weeks of iOS beta.

### 9.3 Stripe Live Switch

Toggle live mode on Stripe + flip the Premium Store from "Coming Soon" to live + enable Pro/Platinum signup CTAs across the app. **Activates revenue.** Requires only ops work, no engineering.

### 9.4 Ads Integration

Wire ad provider (Google AdSense or AdMob for native apps) into free-tier surfaces. Two placements: passive background banner (low intrusion) + interstitial popup between quiz sessions. Pro removes popups; Platinum removes all.

**Why important:** Ads are the only stream that monetizes the 95% of users who never convert to paid. Even at $3 RPM, 100K free users generates ~$900/mo before optimization.

### 9.5 Roulette / Daily Spin

A daily spin-the-wheel feature for engagement — one free spin per day, optional Fangs-funded re-spins. Outcomes: small Fangs prizes (10–500F), boosters, occasional rare cosmetics, very occasional jackpot (10,000F).

**Why important:** Daily-return ritual independent of "did I do the work today." Adds variable reward (the Vegas hook). Comparable: Snapchat's daily streak rewards, Duolingo's chest reveals.

**Risk:** Inflates Fangs supply. Must be balanced against sinks (cosmetics, boosters) so we don't break the economy. Plan: gate jackpot rate so expected value ≤ 100F/day.

### 9.6 Family Console

A multi-account hub for parents/guardians to:
- See their kids' study time, streak, accuracy across subjects
- Set weekly study goals; reward Fangs or real $ on achievement
- Pay for kids' Pro/Platinum subscription as a family plan
- Get weekly progress emails

**Pricing concept:** Family plan = $19.99/mo (vs $14.99 Platinum solo) — covers up to 4 kids. Higher LTV (parents pay more reliably + don't churn out of "I'm broke this month").

**Why important:** Parents are the wallet. We've been pitching to students; pitching to parents unlocks a whole second buyer persona.

### 9.7 macOS Desktop App

Wrap the web app in Electron or native SwiftUI shell. Adds:
- Always-on status bar widget (streak + daily target)
- System notifications for streak warnings
- Cmd+Shift+L global hotkey to open Quick Note from anywhere
- Offline-friendly for plane/library studying

**Effort:** ~2 weeks for an Electron wrapper, ~6 weeks for native. Recommend Electron first.

### 9.8 Server-Side Reward RPC Migration

Currently `incrementCoins`/`incrementXP` in `lib/db.ts` is fetch-then-update — race condition risk under concurrent quiz completions. Migrate to a Postgres function. **Boring but critical** — prevents currency exploits.

---

## 10. Mid-Term Roadmap (Q4 2026 – Q2 2027)

### 10.1 Real Cash Payouts (V2)

The headline V2 milestone. Top performers in monthly leaderboards earn real money.

**Mechanism:**
- Fangs → cash conversion at 1,000F → $1 (tentative)
- Monthly prize pool funded by ~10% of subscription revenue + entry fees on optional opt-in tournaments
- Payout via Stripe Connect to verified accounts (KYC required for $50+)
- Cap monthly payouts per user to prevent abuse

**Why this matters:** Differentiates Lionade from every other study app on day one. The pitch becomes "study and we'll actually pay you" — that's a marketing moat, not a feature.

### 10.2 Ninny AI Study Companion

Already in flight (Mastery Mode is the foundation). Expand to:
- Chat about any uploaded material (PDF, screenshot, paste)
- Generate practice questions in any format on demand
- Personalized weekly study plan that adapts to performance
- Voice mode (TTS for explanations, STT for verbal Q&A)

### 10.3 Tutoring Marketplace (V3)

Top-ranked users opt in to tutor lower-ranked users. Lionade takes 15–20% of session price. Pricing set by tutor ($10–$50/hr). Built-in scheduling, video, payments.

**Why this matters:** Pure-margin revenue. Doesn't require us to do the teaching. Strongest users become our distribution.

### 10.4 Weekly Tournaments

Bracket-style competition with structured prize pools. 16/32/64-player single-elim. Entry fee in Fangs; winner gets cash or rare cosmetic.

### 10.5 School / Teacher Bulk Licensing

Sell Lionade Premium access to schools at bulk rate. Teacher dashboard for class-wide assignments, leaderboards, progress reports.

**Pricing concept:** $5/student/year for schools (vs $69.99 retail). Hits a 10× user volume target if we close even 100 schools (avg 500 students/school = 50K users at $250K ARR).

---

## 11. Future Feature Ideas

A grab-bag. Not committed. Sorted roughly by upside × feasibility.

### 11.1 High-Confidence Wins

| Idea | What | Why |
|---|---|---|
| **Battle Pass ($4.99/mo)** | Seasonal cosmetic upgrade on top of any tier | Fortnite/Snap+ proved this; near-zero variable cost; could rival ad revenue |
| **Daily Spin (Roulette)** | One spin per day, prize wheel | Daily return ritual; variable rewards = Vegas hook |
| **Family Console** | Parent dashboard + family plan | Parents are the wallet; LTV much higher |
| **macOS app + status bar widget** | Always-visible streak + Quick Note hotkey | Keeps Lionade top-of-mind for power users |
| **Friend referrals with Fangs reward** | Refer a friend → both get 500F | Cheap viral growth; Duolingo and Snapchat lean on this |
| **Push notification streak warnings** | "Your 47-day streak ends in 2 hours" | Single highest-leverage retention message |
| **Rewarded video ads** | Watch ad → earn Fangs | Voluntary, $8–$15 RPM, doesn't piss off paying users |
| **Affiliate links in study material** | Amazon textbook + Notion + Grammarly refs | $0.10–$0.20/MAU passive income |
| **Lionade gift cards** | $25/$50/$100 Fangs cards via Apple/Google/Stripe | Holiday + birthday revenue spike, near-100% margin |
| **Premium content packs** | SAT/ACT/MCAT/Bar prep packs at $9.99 each | One-time IAP, near-zero variable cost |

### 11.2 Speculative / Higher Variance

| Idea | What | Why |
|---|---|---|
| **Wagering with friends** | Direct head-to-head Fangs/cash bets between friends | High engagement; legal/regulatory complexity |
| **Sponsored brand quizzes** | Notion/Chegg sponsors a 10Q quiz; users earn 2× Fangs | $5K–$50K per integration, brands love engaged Gen Z |
| **Direct-sponsor weekly challenge** | "This week's bounty board sponsored by Calculator.net" | Recurring sponsor cadence; predictable revenue |
| **Lionade for Teachers (B2B SaaS)** | $99/mo per classroom dashboard | Untapped budget; 100 classrooms = $119K/yr |
| **Anonymized data insights** | Sell aggregated "what students struggle with" to publishers | High-margin B2B; needs careful privacy/legal |
| **AI Tutor Premium tier** | $19.99/mo above Platinum for priority Ninny + voice mode | ChatGPT Plus model; small % of Platinum users will upgrade |
| **Cosmetic NFTs / digital trading cards** | Limited-edition badges that users can trade | Pump for power users; reputational risk |
| **AI-generated personalized quiz** | Generate a quiz on-demand from user's weak topics | Already partially there via Mastery Mode; expand to all subjects |
| **Voice-only mode (Alexa-style)** | "Ninny, quiz me on biology" | Differentiated; small market today |
| **Public profile pages** | `lionade.com/u/sam` shareable profile | Free organic SEO; social-proof for app stores |
| **Discord integration** | Streak announcements + leaderboards in Discord servers | Gen Z lives on Discord |
| **Group study rooms (live Pomodoro)** | 6-person video lobby with shared timer | "Study with me" YouTube videos validate the demand |
| **Streak insurance** | $0.99/mo to never lose a streak | Snapchat-style microtransaction; high margin |
| **Parent-paid allowance** | Parent loads $X/mo into kid's wallet, kid earns it by hitting study targets | The financial-literacy angle parents love |

### 11.3 Long-Tail / Defensive

| Idea | What | Why |
|---|---|---|
| **Arabic / Spanish localization** | Two highest-leverage non-English markets for our target | International growth |
| **Offline-first mobile** | Cache 50 questions locally; sync on connect | "Studying on a plane" use case |
| **GDPR / FERPA compliance pass** | Required if we sell to schools | Sales unlock |
| **API for third-party LMS integrations** | Canvas, Schoology, Google Classroom | Schools won't adopt without it |
| **In-app tutorial / first-quiz cinematic** | Gorgeous onboarding that explains Fangs in 30s | Cuts D1 dropoff |

---

## 12. Tech Stack & Infrastructure

| Layer | Technology | Notes |
|---|---|---|
| Web framework | Next.js 14.2.35 (App Router) | All pages `"use client"` |
| Mobile framework | Expo + EAS | iOS/Android shared codebase |
| Language | TypeScript (strict) | |
| Styling | Tailwind CSS 3.4.1 | Custom keyframes in `globals.css` |
| Database | Supabase (PostgreSQL + Auth + Realtime) | 45 migrations |
| Data fetching | SWR | `keepPreviousData: true` everywhere |
| AI | OpenAI (gpt-4o, gpt-4o-mini), Anthropic (Sonnet 4.6), Gemini, Groq | Routed via `lib/ai.ts` |
| Payments | Stripe (wired, not live) | |
| Email | Resend | |
| Hosting | Vercel | Auto-deploy on push to `main` |
| CDN | CloudFront | Static images via `cdnUrl()` helper |
| Storage | Supabase Storage | `class-syllabi` bucket with RLS |
| PDF parsing | `pdf-parse` v2 | `serverComponentsExternalPackages` for webpack |
| Icons | @phosphor-icons/react | |
| Fonts | Bebas Neue, Syne, DM Mono | next/font/google |

---

## 13. Risks & Open Questions

### 13.1 Top Risks

1. **Free-tier AI cost spirals as users use Mastery Mode more.** $3/mo is a sustainable Pro cost; if free users start hitting that AI usage, the unit economics break. Mitigation: hard daily AI request caps for free users + cheaper-model routing for free-tier requests.

2. **Conversion to paid stays under 3%.** Then we're at perpetual loss. Mitigation: aggressive A/B on paywall placement, free trial offers, founding-member pricing, friction at "set up class notebook" → "upgrade to track 3 classes."

3. **Real cash payouts attract fraud.** Bot accounts farming Fangs for cash-out. Mitigation: server-side anti-cheat is already in; add device fingerprinting, KYC at $50+ payout, machine-learning anomaly detection on quiz patterns before V2 ships.

4. **App Store rejection for cash-payout mechanics.** Apple rejects gambling-adjacent apps. Mitigation: payout system can be web-only (App Store can't reject our website); structure payouts as scholarships/rewards rather than gambling-style payouts.

5. **Question-bank quality plateaus.** AI-generated questions drift in quality. Mitigation: human review workflow, user-flag bad questions, Gemini-as-a-judge eval pass before publishing.

### 13.2 Open Questions

- **What's the right Free → Pro paywall trigger?** Currently 1 mastery target on free. Options: 5 quizzes/day cap? Class limit (3 max)? Premium AI features only?
- **Is Platinum priced too low?** Power users (we have a few testing) easily get $50/mo of value. Could we charge $24.99 for Platinum and keep Pro at $6.99?
- **Should ads run on Pro tier too** (just no popups), or is ads-free the Pro hook itself? Currently background ads stay on Pro.
- **Real cash payouts — open to all states/countries, or US-only at launch?** Regulation varies. US-only at launch is safer.
- **Family Console pricing — flat or per-kid?** $19.99 flat is simpler; $9.99 + $4.99/kid is more expandable.

---

## Appendix: Quick Numbers Cheat-Sheet

### Pricing
| Number | Value |
|---|---|
| Pro price (mo / annual) | $6.99 / $69.99 |
| Platinum price (mo / annual) | $14.99 / $149.99 |
| Family Plan (planned) | $19.99/mo, up to 4 kids |
| Battle Pass (planned) | $4.99/mo on top of any tier |
| Teacher Edition (planned) | $99/mo per classroom |
| Stripe fee | 2.9% + $0.30 |

### Unit Economics
| Number | Value |
|---|---|
| AI cost — Pro / Platinum user | ~$3 / ~$5 per mo |
| AI cost — Free user (target with controls) | ≤$0.20/mo |
| Pro gross margin (annual prepay) | 35% |
| Platinum gross margin (annual prepay) | 53% |
| Battle pass / cosmetics gross margin | 92–95% |
| Ads gross margin (after ad-tech tax) | ~70% |
| Affiliate gross margin | ~100% |

### Ads (Layered Strategy)
| Network | Use case | Expected RPM |
|---|---|---|
| Google AdSense | Web display | $2.50–$4 |
| Google AdMob | Mobile native | $4–$7 |
| Meta Audience Network | Mobile + secondary web | $4–$6 |
| TikTok Audience Network | Tertiary, demo match | $6–$10 (when fills) |
| Unity Ads / AppLovin / ironSource | Rewarded video | $8–$15 |
| **Blended target** | All-in | **$5–$8** |

### Targets to Profitability
| Lever | Target | Why |
|---|---|---|
| Paid conversion rate | ≥5% of MAU | Below 3% = perpetual loss |
| Annual prepay share | ≥50% | Cuts Stripe fees materially |
| Free AI cap | ≤$0.20/user/mo | Single biggest lever |
| Battle pass uptake | ≥5% of MAU | Adds 50–80% to sub revenue |
| Layered ad RPM | ≥$5 blended | Single-network gets you $2 |

### V2/V3 Reference
| Number | Value |
|---|---|
| Fangs cash-out anchor | 1,000F → $1 |
| Tournament take rate | 15% |
| Tutoring marketplace take | 15–20% |
| Cash payouts ≤ % of subs | 10% |

### Break-Even (Realistic Model)
| Scenario | DAU |
|---|---|
| Conservative | ~3,000 DAU |
| Base | <1,000 DAU |
| Optimistic | <500 DAU |

*The realistic model with AI controls + full ad stack + battle pass is profitable from day one. The original pessimistic model assumed no AI controls and only 4 revenue streams — that's the trap to avoid.*

---

*Maintained by Sam. Update whenever pricing, costs, or roadmap changes — this is the doc we trust.*
