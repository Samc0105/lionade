# Project State: Lionade

## Current Features
- Coming soon landing page at `/` with hidden DevOps access gate (5-click copyright).
- Auth flow (login + multi-step signup) backed by Supabase auth.
- Authenticated app shell with slim navbar, coin/streak pills, and route protection.
- **Nav: Dashboard | Learn | Compete** (3 tabs only). Profile accessed via avatar dropdown.
- **Avatar dropdown menu** with Profile, Badges, Wallet/Rewards, Settings, Help/Support, Log Out.
- **Mobile bottom nav** (Home, Learn, Compete) replaces hamburger menu.
- **CTA "Clock In" button** in nav bar routes to /quiz.
- **Dashboard** = modern command center: hero header (welcome + date + status chip), compact stat pills row (coins/streak/level/subjects), inline XP bar, hero mission module (centerpiece CTA), horizontal "Continue" shelf (Netflix-style scroll), two-column lower (subjects left, activity + Ninny's Notes right). No boxy 2x2 grid. Minimal borders, gradient-based depth.
- **Learn** = Circle/bubble UI with 4 options: Daily Quiz, Subjects, Practice Sets, Study With Ninny (Soon). Vertically centered 2x2 bubble grid with hover glow/scale effects, modals for coming-soon features.
- **Compete** = rank summary strip + 3 mode tiles (Duel, Blitz, Leaderboard) + Weekly Tournament placeholder.
- Daily quiz flow with timed questions, scoring, and Supabase session persistence.
- Duel flow with invite + simulated opponent and best-effort Supabase duel record.
- Leaderboard page (weekly/all-time toggle UI) pulling from Supabase.
- Profile page with overview, badges, stats, and quiz history.
- Security: rate limiting, input sanitization, brute force protection, session expiry, security headers.

## Files/Dirs That Matter Most
- `app/layout.tsx` — Root layout, fonts, global providers, navbar.
- `app/page.tsx` — Coming soon page + hidden DevOps access gate.
- `app/login/page.tsx` — Login + signup UI and validation.
- `app/dashboard/page.tsx` — Performance command center (stats, today's plan, subjects, history, insight).
- `app/learn/page.tsx` — Learn hub with 4 sections + Ninny modal.
- `app/compete/page.tsx` — Compete hub with rank strip + mode tiles + tournament.
- `app/quiz/page.tsx` — Quiz runtime, scoring, persistence.
- `app/duel/page.tsx` — Duel UX (currently simulated opponent).
- `app/leaderboard/page.tsx` — Rankings UI.
- `app/profile/page.tsx` — User profile, badges, stats, history.
- `components/Navbar.tsx` — Slim nav, 3 tabs, CTA button, avatar dropdown, mobile bottom nav.
- `lib/auth.tsx` — Auth context, Supabase auth integration, session expiry.
- `lib/db.ts` — Supabase queries and mutation helpers.
- `lib/supabase.ts` — Supabase client init.
- `lib/supabase-server.ts` — Server-only admin Supabase client.
- `lib/sanitize.ts` — Input sanitization (XSS/SQL injection prevention).
- `lib/mockData.ts` — Mock users/questions, UI helpers (icons/colors/formatting).
- `lib/database.sql` — Full Supabase schema + RLS + triggers.
- `middleware.ts` — Rate limiting + security headers middleware.
- `components/StatCard.tsx` — Reusable stat card (icon, value, label, insight, accent color).
- `components/StatsGrid.tsx` — 2x2 grid of StatCards for dashboard.
- `components/*` — Other shared UI pieces (ProtectedRoute, QuizCard, etc.).

## Page Roles (Information Architecture)
- **Dashboard** = "How am I doing?" — personal performance, stats, progress, insights
- **Learn** = "How do I improve?" — quiz, subjects, practice, AI study
- **Compete** = "How do I prove myself?" — duels, blitz, leaderboard, tournaments
- No duplicated navigation tiles between pages.

## UI + Features Pass (Latest)
### What Changed
- **Dashboard**: Removed Learn/Compete/Library navigation tiles. Added 5 sections: Performance Snapshot (stats strip + micro insights), Today's Plan (daily challenge CTA), Subject Progress (progress bars + Continue buttons), Study History (recent sessions from DB or mock), Lionade Insight (Ninny placeholder with AI tips).
- **Learn**: Reorganized into 4 sections with headings: Quick Practice (Daily Quiz), Structured Learning (Subjects), Focus Mode (Practice Sets), AI Study Mode (Study With Ninny). Ninny card has "Upload Material" and "Tell Ninny What to Study" buttons that open coming soon modals.
- **Compete**: Added rank summary strip (rank, wins, win streak, top 10% goal). Added Weekly Tournament (Soon) placeholder tile. Kept Duel/Blitz/Leaderboard tiles.
- No nav/routing changes needed (previous pass already set up correctly).

### Files Touched
- `app/dashboard/page.tsx` — Full rewrite as performance command center
- `app/learn/page.tsx` — Reorganized with 4 sections + Ninny modal
- `app/compete/page.tsx` — Added rank strip + tournament placeholder

### How to Test
1. **Dashboard**: Should show stats strip with micro insights, Today's Plan card, Subject Progress bars with Continue buttons, Recent Sessions list, Lionade Insight panel. No Learn/Compete/Library tiles.
2. **Learn**: Should show 4 section headings (Quick Practice, Structured Learning, Focus Mode, AI Study Mode). Study With Ninny card should have 2 buttons. Clicking either opens a modal with "Coming soon" text and a "Got it" dismiss button.
3. **Compete**: Should show rank summary strip at top (4 stats), 3 mode tiles (Duel/Blitz/Leaderboard), Weekly Tournament card at bottom.
4. All existing routes (/quiz, /duel, /leaderboard, /profile) still work.
5. Mobile: no overflow, bottom nav works, no horizontal scroll.

## Known Issues / Tech Debt
- Duel uses `QUIZ_QUESTIONS` + `MOCK_USERS` (not real opponent matchmaking or DB-backed questions).
- Leaderboard filter toggle does not change data source (always `getLeaderboard`).
- Client-side `incrementCoins`/`incrementXP` in `lib/db.ts` is unsafe for production (should be RPC/secure server-side).
- Quiz relies on client-side timers; no server validation of answers or time.
- Several UI utilities (`formatCoins`, level calc, subject icons/colors) live in `lib/mockData.ts` with other mock data.
- Blitz mode, Library, Study With Ninny, Weekly Tournament are placeholders (coming soon).
- Dashboard micro insights and Lionade Insight tips are mock text.
- Compete rank strip uses mock values (0 wins, unranked).

## Dashboard Refinement Pass (Latest)
### What Changed
- **Stats**: Replaced flat stats strip with 2x2 grid of premium stat cards. Each card has icon, large value, label, and micro-insight line (+X today, Best: X days, X XP to next, X active). Created reusable `StatCard.tsx` and `StatsGrid.tsx` components.
- **XP Bar**: Made taller (h-3.5), wider, with subtle glow. Placed as centerpiece below stats grid.
- **Ninny AI Coach**: Moved from right sidebar to full-width centered section below XP bar. 3 insight bullets, "Want a quick review?" prompt, 2 disabled buttons (Review Weak Area, Ask Ninny).
- **Today's Mission**: Renamed from "Today's Plan". Shows "Complete Daily Quiz" with 0/1 progress indicator. Secondary-style CTA (outline button) to avoid competing with nav "Clock In".
- **Empty States**: Premium empty states for Recent Sessions ("No sessions yet" with icon + CTA) and Recent Activity ("No activity yet" with icon + explanation).
- **Spacing/Hierarchy**: Welcome header made smaller (text-2xl). Stats grid is first focal point. Consistent gap-5 between sections. No duplicate strong CTAs above fold.

### Files Touched
- `components/StatCard.tsx` — New reusable component
- `components/StatsGrid.tsx` — New reusable component
- `app/dashboard/page.tsx` — Full layout rewrite

### How to Test
1. `npm run dev` then visit http://localhost:3002/dashboard
2. Verify: 2x2 stat cards (Coins/Streak/Level/Subjects) with micro-insights
3. Verify: XP bar below stats, thicker than before, gradient fill
4. Verify: Ninny AI Coach centered, 3 bullets, 2 disabled buttons
5. Verify: "Today's Mission" with 0/1 indicator and outline-style CTA
6. Verify: Subject Progress with Continue links
7. Verify: Right column has Recent Sessions + Recent Activity with empty states
8. Verify: /learn and /compete still render, nav still works
9. Shrink browser window — no overflow or layout breaks

### TODOs / Future Polish
- Wire Ninny insights to real data (weak subjects, time-of-day patterns)
- Track daily quiz completion state per user (currently mock)
- Replace mock subject data with real `getSubjectStats` when user has history
- Add streak "Best" from profile data instead of current streak

## Learn Page Redesign (Circle/Bubble UI)
### What Changed
- Replaced card-based layout with a clean circle/bubble UI centered vertically on the page.
- **Hero**: "LEARN" title with electric glow effect, subtitle, directional hint "Start with Daily Quiz to build streaks.", and live progress row (streak, XP, coins from auth context).
- **2x2 Bubble Grid**: 4 circular buttons with color-coded radial gradients, centered icons (emoji), titles and subtitles beneath. Daily Quiz bubble is ~10% larger with stronger glow (primary action hierarchy).
- **Hover effects**: Bubbles scale up (1.1x), lift (-translate-y-1), outer glow halo fades in (blurred color ring), border glow intensifies, title text gains color shadow. All smooth 500ms transitions.
- **Click behavior**: Daily Quiz → `/quiz`, Subjects → `/quiz`, Practice Sets → ComingSoonModal, Study With Ninny → NinnyModal.
- **NinnyModal**: Title "Study With Ninny (Coming Soon)", description text, two disabled buttons "Upload Material (Soon)" and "Tell Ninny What to Study (Soon)", "Got it" dismiss. Icon displayed in a glowing circle.
- **ComingSoonModal**: Practice Sets with "Coming Soon" badge, description, "Got it" dismiss. Icon in glowing circle.
- **Responsive**: 2x2 grid scales down on mobile (w-28 bubbles, gap-8), no horizontal overflow. Content vertically centered in viewport.
- **Dashboard**: Untouched (kept as-is).

### Files Touched
- `app/learn/page.tsx` — Full rewrite as circle/bubble UI

### How to Test
1. `npm run dev` then visit `/learn`
2. Verify: 4 circular bubbles in 2x2 grid (Daily Quiz blue, Subjects purple, Practice Sets green, Study With Ninny orange)
3. Verify: Hovering a bubble shows scale-up + glow + lift effect
4. Verify: Clicking "Daily Quiz" navigates to `/quiz`
5. Verify: Clicking "Subjects" navigates to `/quiz`
6. Verify: Clicking "Practice Sets" opens Coming Soon modal with "Got it" button
7. Verify: Clicking "Study With Ninny" opens Ninny modal with title "(Coming Soon)", 2 disabled buttons, "Got it" dismiss
8. Verify: Modals close on Escape key and click-outside
9. Verify: On mobile (narrow viewport), bubbles remain 2x2 at smaller size, no overflow
10. Verify: Nav stays Dashboard | Learn | Compete, avatar dropdown still works

## Dashboard Redesign (Command Center, Not "All Boxes")
### What Changed
- Removed 2x2 StatCard grid and big bordered card sections. Replaced with open, gradient-based layout.
- **Hero Header**: "Welcome back, {name}" with today's date and "Ready to study" status chip on the right (desktop).
- **Stat Pills**: 4 compact rounded-full pills (coins, streak, level, subjects) with icons, values, and micro text. Glass-style `bg-white/[0.03]` backgrounds with hover brighten. Wraps on mobile.
- **XP Bar**: Inline progress bar (no card wrapper). Level label + "X% to Level N" text above a slim h-2 gradient bar.
- **Mission Hero**: Full-width centerpiece module with target icon, "TODAY'S MISSION" title, "Complete Daily Quiz" description, reward text, primary CTA button, progress indicator "0/1", mock reset timer "Resets in 14h". Subtle radial gradient accent decoration.
- **Continue Shelf**: Horizontal Netflix-style scroller. Daily Quiz card + up to 4 subject cards with mini progress bars. Cards are w-36, rounded-xl, with color-coded gradient backgrounds. Hidden scrollbar.
- **Subjects Section**: Light rows (no card wrapper), hover highlight `bg-white/[0.03]`, progress bars, "Continue" links.
- **Recent Activity**: Borderless list rows with hover highlight. Empty state: coin emoji + "No activity yet — take your first quiz" + CTA.
- **Ninny's Notes**: Compact panel in right column. 2 insight bullets, 2 disabled action buttons ("Review Weak Spot (Soon)", "Ask Ninny (Soon)"), "Ninny is analyzing your progress..." typing hint.
- **Overall**: Fewer hard borders, more gradients + spacing, clearer visual hierarchy (hero → pills → mission → shelf → details).

### Files Touched
- `app/dashboard/page.tsx` — Full rewrite
- `app/globals.css` — Added `.scrollbar-hide` utility for horizontal shelves

### How to Test
1. `npm run dev` then visit `/dashboard`
2. Verify: Hero header with welcome text + date + status chip (desktop)
3. Verify: 4 stat pills in a row (wrap on mobile), not big cards
4. Verify: Slim XP bar with level info, no card border
5. Verify: Big mission hero module with "Start Daily Quiz" CTA → navigates to `/quiz`
6. Verify: "Continue" horizontal shelf scrolls, shows Daily Quiz + subject cards
7. Verify: Subject cards in shelf have mini progress bars
8. Verify: Lower section has subjects (left) + activity/Ninny (right)
9. Verify: Ninny's Notes has 2 insights + 2 disabled buttons + typing hint
10. Verify: Activity empty state shows coin emoji + "Start Quiz" button
11. Verify: `/learn` bubble layout untouched and works
12. Verify: `/compete` untouched and works
13. Verify: Mobile — pills wrap, shelf scrolls horizontally, no overflow

## Dashboard Micro-Polish Pass (Game-Feel)
### What Changed
- **Micro-animations**: Stat pills now lift 1px + brighten on hover (`hover:-translate-y-[1px] hover:brightness-110 transition-all duration-200 ease-out`). Mission hero card brightens on hover (`hover:brightness-[1.03]`). Continue shelf cards scale up + lift on hover (`hover:scale-[1.03] hover:-translate-y-1`). Subject rows and activity rows use `transition-all` for smoother highlight.
- **XP bar drama**: Bar thicker (h-2 → h-3). Added XP fraction text ("0 / 1,000 XP"). Animated fill on mount: starts at 0% width and transitions to real value after 200ms delay (`xpMounted` state + `transition-all duration-700 ease-out`). Glow slightly intensified.
- **CTA pulse**: "Start Daily Quiz" button has a `cta-pulse` class — subtle 5-second box-shadow pulse cycle (not flashy). Added via `@keyframes cta-glow` in globals.css.
- **Gamification tease**: New "THIS WEEK" module in right column (above Recent Activity). Shows "Your rank: — (soon)", "Top player: — (soon)", "Win duels to climb the leaderboard." Small, same style as other modules.
- **Coins hint**: Added "Coins will unlock rewards soon." line under the mission CTA area.
- **Empty state upgrade**: Recent Activity empty state now has structured layout: large coin emoji, bold "No activity yet" title, body text, "Start Quiz" CTA. Subtle background gradient + border.
- **Dynamic greeting**: Subtitle changes by time of day — "Let's build momentum." (morning), "Keep the streak alive." (afternoon), "One more win before midnight." (evening). Client-side only.
- **Reduced motion**: Added `@media (prefers-reduced-motion: reduce)` rule in globals.css that disables `cta-pulse`, `animate-slide-up`, `coin-particle`, and `pulse-ring` animations.

### Files Touched
- `app/dashboard/page.tsx` — All polish changes (animations, XP bar, tease module, empty state, greeting)
- `app/globals.css` — Added `.cta-pulse` keyframe + `prefers-reduced-motion` rule

### How to Test
1. `npm run dev` then visit `/dashboard`
2. Verify: Stat pills lift slightly on hover (no layout shift)
3. Verify: Mission card brightens subtly on hover
4. Verify: Continue shelf cards scale + lift on hover
5. Verify: XP bar animates fill on page load (from 0 to actual width)
6. Verify: XP bar shows "0 / 1,000 XP" fraction text
7. Verify: "Start Daily Quiz" button has subtle pulsing glow
8. Verify: "Coins will unlock rewards soon." text under mission
9. Verify: "THIS WEEK" module in right column with rank placeholders
10. Verify: Activity empty state has title + body + button (structured)
11. Verify: Greeting changes based on time of day
12. Verify: `/learn` bubble layout still works perfectly
13. Verify: Mobile — no layout shift, no overflow, pills wrap

## Learn Page Hierarchy & Polish Pass
### What Changed
- **Primary action**: Daily Quiz bubble is ~10% larger (w-[7.5rem]/h-[7.5rem] mobile, w-[10rem]/h-[10rem] desktop) with stronger radial gradient (`28` vs `20` opacity) and stronger glow on hover. Other bubbles unchanged in size.
- **Micro-descriptions upgraded**: Daily Quiz → "5 min \u2022 +10 coins", Subjects → "Track mastery across 7 topics", Practice Sets → "Timed focus sessions", Study With Ninny → "AI summaries \u2022 Flashcards".
- **Hover tuned**: Scale reduced from 1.10 to 1.05, lift from 4px to 2px, brightness-110 added, transitions tightened to `duration-200 ease-out`. No layout shift. Icon scale reduced to 1.05.
- **Progress row**: Added live stat row under hero (streak, XP, coins from `useAuth`). Very small, low opacity, horizontally centered.
- **Directional hint**: "Start with Daily Quiz to build streaks." added under subtitle in low-opacity text.
- **Ninny extra line**: "Personalized AI study coach." added below Ninny's subtitle.

### Files Touched
- `app/learn/page.tsx` — Hierarchy, descriptions, hover, progress row, hint, Ninny extra line

### How to Test
1. `npm run dev` then visit `/learn`
2. Verify: Daily Quiz bubble is visibly larger than the other 3
3. Verify: Updated subtexts ("5 min \u2022 +10 coins", etc.)
4. Verify: Hover gives smooth scale (1.05) + brightness + glow, no layout shift
5. Verify: Progress row shows streak/XP/coins under hero
6. Verify: "Start with Daily Quiz to build streaks." hint visible
7. Verify: Ninny shows "Personalized AI study coach." extra line
8. Verify: Mobile — grid stacks as 2x2, no overflow, text readable
9. Verify: `/dashboard` untouched

## Idle Micro-Animations (Alive Feel)
### What Changed
- **globals.css**: Added 6 keyframes (`floatSlow`, `pulseSoft`, `tiltTiny`, `shimmerGlow`, `shimmerBar`) and 7 utility classes (`idle-float`, `idle-pulse`, `idle-tilt`, `idle-shimmer`, `idle-shimmer-bar`, `idle-glow-mission`, `idle-glow-ninny`). All respect `prefers-reduced-motion`.
- **Learn page** (`app/learn/page.tsx`): Each bubble circle wrapper has `idle-float` with staggered duration (5–7.1s) and delay (0s / 1.2s / 2.4s / 3.6s). Ninny bubble has an additional `idle-pulse` breathing glow behind it.
- **Compete page** (`app/compete/page.tsx`): Duel icon has `idle-tilt` (tiny 2deg rotation every 6.5s). Blitz icon has `idle-pulse` (soft opacity pulse every 4.5s, delay 1s). Leaderboard icon has `idle-shimmer` (glow pulse every 5.5s, delay 0.5s). Weekly Tournament card has an `idle-shimmer-bar` overlay (slow purple gradient sweep every 8s).
- **Dashboard** (`app/dashboard/page.tsx`): Mission Hero card has `idle-glow-mission` (subtle border glow pulse every 7s). Ninny's Notes card has `idle-glow-ninny` (subtle border glow pulse every 9s). Stat pills and XP bar are NOT animated (kept stable).

### Files Touched
- `app/globals.css` — Keyframes + utility classes + updated reduced-motion rule
- `app/learn/page.tsx` — `idle-float` on bubble wrappers, `idle-pulse` on Ninny
- `app/compete/page.tsx` — `idle-tilt` / `idle-pulse` / `idle-shimmer` on tile icons, `idle-shimmer-bar` on tournament
- `app/dashboard/page.tsx` — `idle-glow-mission` on mission card, `idle-glow-ninny` on Ninny's Notes

### How to Test
1. `npm run dev` then visit `/learn` — bubbles gently float up/down (2px), staggered. Ninny has a faint breathing glow.
2. Visit `/compete` — Duel icon tilts, Blitz icon pulses, Leaderboard icon shimmers. Tournament bar has slow gradient sweep.
3. Visit `/dashboard` — Mission card has subtle border glow pulse. Ninny's Notes has slower glow pulse. Stat pills are stable.
4. Hover any card — smooth 220ms transitions, no layout shift.
5. Enable "Reduce motion" in OS — all idle animations stop.
6. Mobile — animations still smooth, no jank.

## Recent Changes
- **Idle micro-animations**: Float, pulse, tilt, shimmer on Learn/Compete/Dashboard. All respect reduced motion.
- **Learn page polish**: Primary action hierarchy, better descriptions, tuned hover, live progress row, directional hint, Ninny extra line.
- **Dashboard micro-polish**: Hover animations, XP bar drama, CTA pulse, "This Week" tease, coins hint, empty state upgrade, dynamic greeting, reduced motion support.
- **Dashboard redesign**: Command center with stat pills, mission hero, continue shelf, Ninny's Notes. No boxy 2x2 grid.
- **Learn page redesign**: Circle/bubble UI with 4 options, hover glow/scale effects, vertically centered layout, enhanced modals.
- CSS/styling fix: Removed duplicate CSP headers from `next.config.js` (middleware.ts handles them).
- UI + features pass: Dashboard as performance center, Learn with Ninny, Compete with rank strip.
- Nav + UI cleanup: slim nav, 3 tabs, avatar dropdown, /learn + /compete hub pages.
- Security layers: rate limiting, input sanitization, brute force protection, session expiry, security headers.

## Next 5 High-Impact Tasks (Ranked)
1. Build Ninny AI study mode (upload material, generate flashcards/questions).
2. Replace mock duel opponents/questions with real Supabase-backed matchmaking.
3. Move coin/XP awarding to secure server-side RPC with validation.
4. Build out Blitz mode (speed round gameplay).
5. Implement weekly tournament system with bracket and rewards.
