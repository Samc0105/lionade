# Feature Registry

## Auth & Onboarding
- **Email/password + Google OAuth login/signup** — 2026-02-19
- **Sign in with Apple (web)** (`/login` Log In + Sign Up tabs both show a black "Continue with Apple" button beneath the Google button; `supabase.auth.signInWithOAuth({ provider: 'apple' })` mirroring iOS; redirect-back to current origin like the Google flow) — 2026-05-24
- **Multi-step onboarding flow** — 2026-02-24
- **Session expiry + brute force protection** — 2026-02-20
- **ProtectedRoute with self-healing profile rows** — 2026-02-24
- **Auto logout after 2 hours of inactivity** — 2026-03-17

## Dashboard
- **Command center layout** (hero header, stat pills, XP bar, mission hero, continue shelf, Ninny's Notes) — 2026-02-28
- **Daily Claim — single-click + faster toast** (the daily-Fangs button: clicking when available now claims **instantly** without auto-opening the history popover; cooldown/claimed state still opens the popover on click. Reveal toast auto-dismiss reduced from 5s → 3s for tighter attention). `components/ClockInButton.tsx` — 2026-05-24
- **Dynamic greeting by time of day** — 2026-02-28
- **Idle glow animations on mission card and Ninny's Notes** — 2026-02-28
- **CTA pulse on "Start Daily Quiz"** — 2026-02-28
- **Reusable `ClaimBanner` + Free→Pro upgrade nudge** (one themeable banner across DailyReady/StreakRevive/ClockIn/DailyDrill claim surfaces; free-tier-only Pro nudge via `usePlan()`, links to /pricing) — 2026-05-17
- **Achievement grid with earned/locked states** — 2026-02-28
- **Streak fire animation with motivational banner** — 2026-02-28
- **Continue shelf with real quiz history** — 2026-02-28

## Learn
- **Circle/bubble UI with 4 options** (Daily Quiz, Subjects, Practice Sets, Study With Ninny) — 2026-02-28
- **Primary action hierarchy** (Daily Quiz bubble larger) — 2026-02-28
- **Hover glow/scale effects, idle float animations** — 2026-02-28
- **Coming soon modals for unreleased features** — 2026-02-28
- **Subjects CTA → Coming Soon block** (the `/learn/paths` Subjects card on `/learn` is now click-blocked with a "Coming Soon" gold pill on the card + a 3-second auto-dismissing toast that says "Subjects & Learning Paths — in development, coming soon"; Daily Quiz / Study with Ninny / Mastery Mode CTAs remain clickable) — 2026-05-24

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
- **Add-Friend popover** (the ADD FRIEND search + Sent Requests list moved out of the always-visible left sidebar into a modal triggered by a gold UserPlus icon button placed in the friends-search header row. Modal: MagnifyingGlass-prefixed search input + autocomplete dropdown + Sent Requests list with "Undo" buttons. Click-outside + X dismiss. Empty-state when no pending requests) — 2026-05-24

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
- **Cross-platform avatar sync (iOS)** (iOS resolves web's DiceBear SVG avatar URLs to PNG — rewriting `/svg`→`/png` — and uses the same DiceBear default web uses, so the same profile picture renders on web and iOS instead of falling back to initials; uploaded photos pass through unchanged) — 2026-05-22

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
- **Coming soon landing page** with hidden DevOps gate — 2026-02-21; **retired 2026-05-24** — went fully public: replaced waitlist CTAs with "START STUDYING FREE" → /login button, removed beta-gate password modal + DevOps secret trigger, deleted `/api/beta-gate` route, demoted waitlist to a small footer newsletter form, updated ROADMAP/FAQ to reflect live V1 status. `ComingSoonPage` renamed to `LandingPage`.
- **Pricing page** (Free/Pro/Platinum, monthly/annual toggle, full comparison, FAQ) — 2026-04-24; premium glassy redesign + page-local Lionade WebGL shader — 2026-05-15

---

## Next 5 High-Impact Tasks (Ranked)

1. Build Ninny AI study mode (upload material, generate flashcards/questions).
2. Replace mock duel opponents/questions with real Supabase-backed matchmaking.
3. Move coin/XP awarding to secure server-side RPC with validation.
4. Build out Blitz mode (speed round gameplay).
5. Implement weekly tournament system with bracket and rewards.

## Academia
- **Academia/Study onboarding gate** (required 5-step setup — school type, class count, school name + grade/year, field of study, study intensity — before the Study tab unlocks; web `/academia/onboarding`. iOS parity port `app/academia-onboarding.tsx` with fail-open `useFocusEffect` gate + gold "+ ADD" CTA) — 2026-05-22

## Navigation
- **iOS bottom-tab parity with web nav** (5 tabs in web-parity order: Home · Academia · Learn · Compete · Social. "Study" renamed to "Academia"; Learn promoted from a pushed Stack screen to a top-level tab; "You" dropped from the tab bar but `/profile` deep-links preserved via `href: null` — the rich profile hub is now reached by tapping the avatar in the profile side panel header. Limelight pill height bumped 58 → 64 with a ±3 translateX + +6 width grow on edge cells so Home and Social hug the bar's rounded inner curve; active pill `top: 3` so it sits vertically centered in the 70pt bar — 2026-05-23) — 2026-05-23

## Navigation
- **Consistent route-based back affordance** (semantic-parent "Back to {Parent}" on every non-root screen, web + iOS; roots/funnels excluded by design) — 2026-05-15
- **Sliding "limelight" bottom-nav highlight** (single travelling gold pill springs to active tab; framer-motion shared-layout on web, Reanimated spring on iOS; reduced-motion → instant; existing gold tokens reused — zero design drift) — 2026-05-19
- **Full-screen edge-swipe-back (iOS)** (`fullScreenGestureEnabled` on the navigation Stack — iOS back-swipe works from anywhere across the screen, not just the ~20px left edge) — 2026-05-22

## Dashboard (iOS)
- **Tappable stat orbs** (all 5 dashboard orbs — Fangs, Streak, Level, Subjects, Rank — open a blurred-backdrop detail window: Fangs balance + View Wallet, current/best streak + next milestone + how-it-works, XP-to-next + progress bar, per-subject accuracy list, View Leaderboard) — 2026-05-22
- **Profile hub side panel** (tapping the top-left avatar opens a left slide-in drawer with blurred backdrop. Avatar with an animated tier-colored breathing neon ring (reduce-motion respected) + tier badge + Fangs balance chip; a gradient "Go Pro" card (dormant PRO-member badge); a 2×3 shortcuts grid — Shop, Wallet, Badges, Leaderboard, Games, Study DNA; Account rows — Edit Profile, Settings, Notifications; More rows — Invite a Friend, Rate Lionade, Help & Support, Privacy & Terms. Rebuilt from the build-9 drawer, fixing label-less rows) — 2026-05-22; polished into a fully-rounded Go-Pro pill with a 7s seamless marquee gradient (gold→purple→electric, reduce-motion respected), 5 shortcut tiles in a centered 2-2-1 grid (Edit Profile · Settings / Notifications · Invite a Friend / Rate Lionade), Help & Support + Privacy & Terms demoted to dim text links above Sign out, and a curved right edge (48px corner radius with a right-edge shadow via a two-layer surface so iOS still draws shadow under the clip) — 2026-05-23; polish v3 — Go-Pro pill marquee now loops byte-identically (7-stop palette with GOLD anchors at 0 / 0.5 / 1.0, no visible refresh), Go-Pro + PRO-MEMBER pills restructured into a two-layer construct (outer paints shadow, inner clips with `overflow: hidden` + `borderRadius: 999`) finally killing the "colors going outside" bleed, and pills are `maxWidth: 300` centered with reduced shadow opacities so the purple glow no longer reads as color leak — 2026-05-23
- **Blurred-backdrop bottom sheets** (shared `Sheet` component blurs the app behind it via `expo-blur` with a hairline-bordered floating-card edge; Quick Note capture sheet capped below full-screen to read as a floating window) — 2026-05-22

## Profile (iOS)
- **Profile tab → full settings hub** (the "You" tab rewritten as one long scrollable Apple-HIG inset-grouped page: hero + stat strip on top, then Lifetime / Recent Badges / Stats & Rankings / Account / Subscription / Appearance / Notifications / Privacy / Recent Activity / Support / About / Sign out + Delete account. Every section from web's `/settings` is mirrored inline; toggles share the same Supabase `user_preferences` row + AsyncStorage keys as `/settings` so changes round-trip across screens) — 2026-05-23
- **App-icon variant gating (iOS)** (Midnight / Wildfire / Platinum / Void variants show "SOON" tags + lock overlays + a "Coming Soon" alert on tap, instead of pretending to apply — variant artwork + native icon swap aren't shipped yet) — 2026-05-23

## Settings & Preferences (iOS)
- **Cross-platform onboarding-sync** (iOS auth gate `lib/auth-context.tsx` now also treats a profile as onboarded if `selected_subjects` or `education_level` is present — onboarding-only data, OAuth can't auto-derive — and self-heals by backfilling `onboarding_completed=true`. Web-onboarded accounts no longer get re-prompted on iOS; Apple/Google fresh signups still flow through onboarding correctly) — 2026-05-23

## Learn (iOS)
- **Learn tab — web-parity close-out** (primary CTA deep-links to weakest subject via `/quiz?subject=…`; mastery rows route per-subject; 7-day activity heatmap gained a legend under the grid — less → 5 gold swatches → more — with a gold glow on today's cell; Level stat chip shows the lowercase tier name below the number; RECENT section header gained a tappable `new →` link that starts a fresh quiz) — 2026-05-23

## Compete (iOS)
- **Compete tab restructured** (Top Players mini-leaderboard removed from Compete; replaced with a single "Leaderboard" row at the bottom of the Modes group that routes to `/leaderboard`. `GroupedList`'s `BlurView` wrapper — which was collapsing intrinsic widths and pushing `ModeRow` chevrons below — replaced with a plain matte `View` fill; `ModeRow` labels switched to the safe `Inter` font, chevron is the last sibling after the flex-1 label View, rows have uniform `minHeight: 56`) — 2026-05-23
- **Top-20-with-anchor leaderboard view** (iOS leaderboard screen now renders the top 20 — podium 1–3 + list 4–20 — and if the viewer is outside top 20 their rank is anchored at the bottom in a gold-tinted highlight; covers ranks 21–60 from the fetched entries, with a fallback to absolute rank + profile stats if outside top 60. `useLeaderboard` hook bumped from top-50 → top-60 fetch and now exposes `userRank: number | null`) — 2026-05-23

## Bounties & Bets (iOS)
- **Daily Bet relocated to Dashboard** (web parity — web does not host Daily Bet on Compete. The card now sits inside the Today section between Bounties and the Progress label, returning to its pre-2026-05-13 home) — 2026-05-23
