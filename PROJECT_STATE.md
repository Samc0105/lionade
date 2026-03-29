# Project State: Lionade

> **Full documentation lives in `/docs/`.** See [CLAUDE_AGENT.md](CLAUDE_AGENT.md) for the master index.

## Documentation Structure
- `docs/PROJECT.md` — Project overview, tech stack, env vars, deployment
- `docs/TEAM.md` — Team roles, workflow rules, PR process
- `docs/ARCHITECTURE.md` — App structure, Supabase tables, API routes, file naming
- `docs/FEATURES.md` — Every feature built with dates
- `docs/CHANGELOG.md` — Running log of every change, newest first
- `docs/THEME.md` — Dark/light theme rules, CSS variables, color palette
- `docs/QUESTION_BANK.md` — Subjects, file naming, seed scripts, GitHub Actions

## Quick Commands
```bash
npm run dev                          # Start dev server
npm run build                        # Production build
./scripts/update-docs.sh             # Log a change to CHANGELOG + auto-commit
npx tsx scripts/seed-questions.ts    # Seed all questions into Supabase
```

## Page Roles (Information Architecture)
- **Dashboard** = "How am I doing?" — personal performance, stats, progress, insights
- **Learn** = "How do I improve?" — quiz, subjects, practice, AI study
- **Compete** = "How do I prove myself?" — duels, blitz, leaderboard, tournaments
- No duplicated navigation tiles between pages.

## Known Issues / Tech Debt
- Duel uses `QUIZ_QUESTIONS` + `MOCK_USERS` (not real opponent matchmaking or DB-backed questions).
- Leaderboard filter toggle does not change data source (always `getLeaderboard`).
- Client-side `incrementCoins`/`incrementXP` in `lib/db.ts` is unsafe for production (should be RPC/secure server-side).
- Quiz relies on client-side timers; no server validation of answers or time.
- Several UI utilities (`formatCoins`, level calc, subject icons/colors) live in `lib/mockData.ts` with other mock data.
- Blitz mode, Library, Study With Ninny, Weekly Tournament are placeholders (coming soon).
- Dashboard micro insights and Lionade Insight tips are mock text.
- Compete rank strip uses mock values (0 wins, unranked).

## Next 5 High-Impact Tasks (Ranked)
1. Build Ninny AI study mode (upload material, generate flashcards/questions).
2. Replace mock duel opponents/questions with real Supabase-backed matchmaking.
3. Move coin/XP awarding to secure server-side RPC with validation.
4. Build out Blitz mode (speed round gameplay).
5. Implement weekly tournament system with bracket and rewards.
