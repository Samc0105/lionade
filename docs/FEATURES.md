# Feature Registry

## Auth & Onboarding
- **Email/password + Google OAuth login/signup** — 2026-02-19
- **Multi-step onboarding flow** — 2026-02-24
- **Session expiry + brute force protection** — 2026-02-20
- **ProtectedRoute with self-healing profile rows** — 2026-02-24
- **Auto logout after 2 hours of inactivity** — 2026-03-17

## Dashboard
- **Command center layout** (hero header, stat pills, XP bar, mission hero, continue shelf, Ninny's Notes) — 2026-02-28
- **Dynamic greeting by time of day** — 2026-02-28
- **Idle glow animations on mission card and Ninny's Notes** — 2026-02-28
- **CTA pulse on "Start Daily Quiz"** — 2026-02-28
- **Achievement grid with earned/locked states** — 2026-02-28
- **Streak fire animation with motivational banner** — 2026-02-28
- **Continue shelf with real quiz history** — 2026-02-28

## Learn
- **Circle/bubble UI with 4 options** (Daily Quiz, Subjects, Practice Sets, Study With Ninny) — 2026-02-28
- **Primary action hierarchy** (Daily Quiz bubble larger) — 2026-02-28
- **Hover glow/scale effects, idle float animations** — 2026-02-28
- **Coming soon modals for unreleased features** — 2026-02-28

## Quiz System
- **Timed daily quiz flow with scoring** — 2026-02-27
- **Supabase session persistence** — 2026-02-28
- **Subject-based question routing** — 2026-02-27
- **Difficulty selector cards + answer explanations** — 2026-02-25
- **Anti-cheat wiring** — 2026-02-27
- **Coin burst animation on results** — 2026-02-28

## Arena / Compete
- **Rank summary strip + 3 mode tiles** (Duel, Blitz, Leaderboard) — 2026-02-20
- **Weekly Tournament placeholder** — 2026-02-20
- **Full 1v1 Duel Arena with competitive battles** — 2026-03-20
- **Leaderboard page (weekly/all-time toggle)** — 2026-02-28
- **Idle tilt/pulse/shimmer animations** — 2026-02-28

## Social
- **Social tab with friends and messaging** — 2026-03-20
- **Live username search for adding friends** — 2026-03-20

## Games
- **Games tab** with Roardle, Blitz Sprint, Flash Cards, Timeline Drop — 2026-03-22
- **PDF upload for study material** — 2026-03-22
- **Lion mascot with cursor tracking** — 2026-03-22

## Notifications
- **Real-time notifications system with bell icon** — 2026-03-20

## Shop & Wallet
- **Lion's Den shop** (Coin Store + Premium Store toggle) — 2026-03-06
- **Shop API routes** (purchase, equip, activate-booster) — 2026-03-06
- **Booster integration into quiz flow** — 2026-03-06
- **Wallet/rewards page** — 2026-03-06

## Profile & Badges
- **Profile page** with overview, badges, stats, quiz history — 2026-02-20
- **Badge collection page** — 2026-03-06
- **Avatar picker** (Create/Emoji/Color) — 2026-03-01
- **Username system** (unique check, one change per year) — 2026-03-01

## Settings & Preferences
- **User settings page** (theme, font scaling, compact layout) — 2026-03-04
- **Light/dark theme toggle** — 2026-03-04

## Bounties & Bets
- **Bounty Board** with daily/weekly bounties and claim API — 2026-02-28
- **Daily Bet card** with stake/target picker — 2026-02-28

## Security
- **Rate limiting middleware** (in-memory) — 2026-02-20
- **Input sanitization** (XSS/SQL injection prevention) — 2026-02-20
- **Security headers** (CSP, HSTS, X-Frame-Options) — 2026-02-20

## Other Pages
- **About page** — 2026-02-25
- **Contact/Help page** — 2026-02-25
- **Privacy Policy** — 2026-02-25
- **Terms of Service** — 2026-02-25
- **Demo page** — 2026-02-25
- **Coming soon landing page** with hidden DevOps gate — 2026-02-21

---

## Next 5 High-Impact Tasks (Ranked)

1. Build Ninny AI study mode (upload material, generate flashcards/questions).
2. Replace mock duel opponents/questions with real Supabase-backed matchmaking.
3. Move coin/XP awarding to secure server-side RPC with validation.
4. Build out Blitz mode (speed round gameplay).
5. Implement weekly tournament system with bracket and rewards.
