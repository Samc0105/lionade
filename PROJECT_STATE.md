# Project State: Lionade

## Current Features
- Coming soon landing page at `/` with hidden DevOps access gate (5-click copyright).
- Auth flow (login + multi-step signup) backed by Supabase auth.
- Authenticated app shell with slim navbar, coin/streak pills, and route protection.
- **Nav: Dashboard | Learn | Compete** (3 tabs only). Profile accessed via avatar dropdown.
- **Avatar dropdown menu** with Profile, Badges, Wallet/Rewards, Settings, Help/Support, Log Out.
- **Mobile bottom nav** (Home, Learn, Compete) replaces hamburger menu.
- **CTA "Clock In" button** in nav bar routes to /quiz.
- Dashboard with stats strip, subject mastery, recent activity, and leaderboard preview.
- `/learn` hub page with tiles: Daily Quiz, Subjects, Practice Sets, Library.
- `/compete` hub page with tiles: Duel, Blitz (coming soon), Leaderboard.
- Daily quiz flow with timed questions, scoring, and Supabase session persistence.
- Duel flow with invite + simulated opponent and best-effort Supabase duel record.
- Leaderboard page (weekly/all-time toggle UI) pulling from Supabase.
- Profile page with overview, badges, stats, and quiz history.
- Security: rate limiting, input sanitization, brute force protection, session expiry, security headers.

## Files/Dirs That Matter Most
- `app/layout.tsx` — Root layout, fonts, global providers, navbar.
- `app/page.tsx` — Coming soon page + hidden DevOps access gate.
- `app/login/page.tsx` — Login + signup UI and validation.
- `app/dashboard/page.tsx` — Main authenticated hub (stats strip, quick action tiles).
- `app/learn/page.tsx` — Learn hub with category tiles.
- `app/compete/page.tsx` — Compete hub with category tiles.
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
- `components/*` — Shared UI pieces (ProtectedRoute, QuizCard, etc.).

## Nav + UI Cleanup (Latest)
### What Changed
- **Navbar**: Slimmer (h-12), only 3 tabs (Dashboard/Learn/Compete), "Clock In" CTA button, smaller pill-style coin/streak indicators with hover tooltips, avatar dropdown with 6 menu items, closes on outside click/escape/item select.
- **Mobile**: Bottom nav bar (Home/Learn/Compete) instead of hamburger. Logo + CTA + avatar in top bar.
- **Dashboard**: 4 stat cards replaced with single stats strip. Welcome message restructured with subtitle. Quick Actions changed to 3 big tiles (Learn/Compete/Library).
- **New pages**: `/learn` (4 tiles) and `/compete` (3 tiles) hub pages created.
- **Routing**: /quiz, /duel, /leaderboard still work directly. Just removed from top nav, accessible from hub pages.

### Files Touched
- `components/Navbar.tsx` — Full rewrite
- `app/dashboard/page.tsx` — Redesigned layout
- `app/learn/page.tsx` — New file
- `app/compete/page.tsx` — New file

### How to Test
1. Log in and verify top nav shows only Dashboard | Learn | Compete + "Clock In" button.
2. Click avatar — dropdown should show Profile, Badges, Wallet/Rewards, Settings, Help/Support, Log Out.
3. Click outside dropdown / press Escape — should close.
4. Navigate to /learn — should show 4 tiles (Daily Quiz, Subjects, Practice Sets, Library).
5. Navigate to /compete — should show 3 tiles (Duel, Blitz, Leaderboard).
6. Dashboard should show single stats strip (not 4 separate cards) and 3 quick action tiles.
7. On mobile: bottom nav with Home/Learn/Compete. No hamburger menu.
8. Direct routes (/quiz, /duel, /leaderboard, /profile) should still work.

## Known Issues / Tech Debt
- Duel uses `QUIZ_QUESTIONS` + `MOCK_USERS` (not real opponent matchmaking or DB-backed questions).
- Leaderboard filter toggle does not change data source (always `getLeaderboard`).
- Client-side `incrementCoins`/`incrementXP` in `lib/db.ts` is unsafe for production (should be RPC/secure server-side).
- Quiz relies on client-side timers; no server validation of answers or time.
- Several UI utilities (`formatCoins`, level calc, subject icons/colors) live in `lib/mockData.ts` with other mock data.
- Blitz mode is a placeholder (coming soon).
- Library is a placeholder (links to /learn for now).

## Recent Changes
- Nav + UI cleanup: slim nav, 3 tabs, avatar dropdown, /learn + /compete hub pages, dashboard stats strip.
- Security layers: rate limiting, input sanitization, brute force protection, session expiry, security headers.
- Replaced `/` with a coming soon page and added a hidden DevOps password gate.

## Next 5 High-Impact Tasks (Ranked)
1. Replace mock duel opponents/questions with real Supabase-backed matchmaking + questions.
2. Move coin/XP awarding to secure server-side RPC (or Supabase function) with validation.
3. Implement proper leaderboard scopes (weekly vs all-time) and add server aggregation.
4. Build out Blitz mode (speed round gameplay).
5. Add basic analytics + error logging for auth/quiz/duel flows.
