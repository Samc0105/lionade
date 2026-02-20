# Project State: Lionade

## Current Features
- Coming soon landing page at `/` with hidden DevOps access gate (5-click copyright).
- Auth flow (login + multi-step signup) backed by Supabase auth.
- Authenticated app shell with navbar, coin/streak display, and route protection.
- Dashboard with stats, subject mastery, recent activity, and leaderboard preview.
- Daily quiz flow with timed questions, scoring, and Supabase session persistence.
- Duel flow with invite + simulated opponent and best-effort Supabase duel record.
- Leaderboard page (weekly/all-time toggle UI) pulling from Supabase.
- Profile page with overview, badges, stats, and quiz history.

## Files/Dirs That Matter Most
- `app/layout.tsx` — Root layout, fonts, global providers, navbar.
- `app/page.tsx` — Coming soon page + hidden DevOps access gate.
- `app/login/page.tsx` — Login + signup UI and validation.
- `app/dashboard/page.tsx` — Main authenticated hub.
- `app/quiz/page.tsx` — Quiz runtime, scoring, persistence.
- `app/duel/page.tsx` — Duel UX (currently simulated opponent).
- `app/leaderboard/page.tsx` — Rankings UI.
- `app/profile/page.tsx` — User profile, badges, stats, history.
- `lib/auth.tsx` — Auth context, Supabase auth integration.
- `lib/db.ts` — Supabase queries and mutation helpers.
- `lib/supabase.ts` — Supabase client init.
- `lib/mockData.ts` — Mock users/questions, UI helpers (icons/colors/formatting).
- `lib/database.sql` — Full Supabase schema + RLS + triggers.
- `components/*` — Shared UI pieces (Navbar, ProtectedRoute, QuizCard, etc.).

## Known Issues / Tech Debt
- Duel uses `QUIZ_QUESTIONS` + `MOCK_USERS` (not real opponent matchmaking or DB-backed questions).
- Leaderboard filter toggle does not change data source (always `getLeaderboard`).
- Client-side `incrementCoins`/`incrementXP` in `lib/db.ts` is unsafe for production (should be RPC/secure server-side).
- Quiz relies on client-side timers; no server validation of answers or time.
- Several UI utilities (`formatCoins`, level calc, subject icons/colors) live in `lib/mockData.ts` with other mock data.

## Recent Changes
- Replaced `/` with a coming soon page and added a hidden DevOps password gate.
- DevOps success path uses same-domain `/dashboard` instead of any localhost redirects.

## Next 5 High-Impact Tasks (Ranked)
1. Replace mock duel opponents/questions with real Supabase-backed matchmaking + questions.
2. Move coin/XP awarding to secure server-side RPC (or Supabase function) with validation.
3. Implement proper leaderboard scopes (weekly vs all-time) and add server aggregation.
4. Extract UI helpers from `lib/mockData.ts` into a non-mock utility module.
5. Add basic analytics + error logging for auth/quiz/duel flows.
