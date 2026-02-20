# Project State: Lionade

## Current Features
- Coming soon landing page at `/` with hidden DevOps access gate (5-click copyright).
- Auth flow (login + multi-step signup) backed by Supabase auth.
- Authenticated app shell with slim navbar, coin/streak pills, and route protection.
- **Nav: Dashboard | Learn | Compete** (3 tabs only). Profile accessed via avatar dropdown.
- **Avatar dropdown menu** with Profile, Badges, Wallet/Rewards, Settings, Help/Support, Log Out.
- **Mobile bottom nav** (Home, Learn, Compete) replaces hamburger menu.
- **CTA "Clock In" button** in nav bar routes to /quiz.
- **Dashboard** = performance command center: stats strip, Today's Plan, Subject Progress, Study History, Lionade Insight (Ninny placeholder). No duplicated navigation tiles.
- **Learn** = 4 sections: Quick Practice (Daily Quiz), Structured Learning (Subjects), Focus Mode (Practice Sets), AI Study Mode (Study With Ninny — coming soon modal).
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
- `components/*` — Shared UI pieces (ProtectedRoute, QuizCard, etc.).

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

## Recent Changes
- **CSS/styling fix**: Removed duplicate CSP headers from `next.config.js` (middleware.ts already handles them). Duplicate CSP headers caused browsers to block inline styles in dev mode, resulting in unstyled HTML. Security headers now live only in `middleware.ts`.
- UI + features pass: Dashboard as performance center, Learn with Ninny, Compete with rank strip.
- Nav + UI cleanup: slim nav, 3 tabs, avatar dropdown, /learn + /compete hub pages.
- Security layers: rate limiting, input sanitization, brute force protection, session expiry, security headers.

## Next 5 High-Impact Tasks (Ranked)
1. Build Ninny AI study mode (upload material, generate flashcards/questions).
2. Replace mock duel opponents/questions with real Supabase-backed matchmaking.
3. Move coin/XP awarding to secure server-side RPC with validation.
4. Build out Blitz mode (speed round gameplay).
5. Implement weekly tournament system with bracket and rewards.
