# Lionade -- Full Project Context

## What Is Lionade

Lionade is a **gamified study rewards platform** built by students for students. Users earn an in-game currency called **Fangs** by answering timed quizzes, battling in 1v1 duels, competing in ranked arena matches, and completing daily challenges. The long-term vision is real cash payouts for top performers.

- **Tagline:** "Study Like It's Your Job"
- **Target users:** Gen Z students (middle school through college and self-taught learners)
- **Monetization thesis:** Free to play forever; revenue from optional premium cosmetics, boosters, and (future) Stripe-powered purchases
- **Domain:** getlionade.com
- **Support email:** support@getlionade.com

---

## Team

| Name | Role | Git workflow |
|------|------|-------------|
| **Sam** | Lead developer | Pushes directly to `main` |
| **Santy** | Contributor | Feature branches + PRs |
| **Ethan** | Contributor | Feature branches + PRs |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14.2.5 (App Router, all pages `"use client"`) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS 3.4.1, custom keyframes in `globals.css` |
| Database | Supabase (PostgreSQL + Auth + Realtime) |
| Data fetching | SWR with `keepPreviousData: true` |
| Payments | Stripe (wired but not yet live) |
| Email | Resend |
| Avatars | DiceBear API (10 styles, customizable) |
| Icons | lucide-react |
| Fonts | Bebas Neue (headings), Syne (body), DM Mono (data) |
| Deployment | Vercel, auto-deploy on push to `main` |
| CDN | CloudFront via `NEXT_PUBLIC_CDN_URL` env var; all static images use `cdnUrl()` helper from `lib/cdn.ts` |

---

## Architecture

### Directory Structure

```
app/                     # Next.js App Router pages
  api/                   # API routes (server-side, bypass RLS)
  dashboard/page.tsx     # Personal stats command center
  learn/page.tsx         # Learning hub
  learn/paths/[subject]/ # Structured learning paths with stages
  quiz/page.tsx          # Timed quiz engine
  quiz/ap-exams/page.tsx # AP Exam prep (10 subjects)
  arena/page.tsx         # Ranked 1v1 with ELO
  duel/page.tsx          # Casual 1v1 battles
  compete/page.tsx       # Tier ladder (Bronze-Legend)
  leaderboard/page.tsx   # Weekly/all-time rankings
  games/page.tsx         # Mini-games (Roardle, Blitz, Flashcards, Timeline)
  social/page.tsx        # Friends, messaging, challenges
  shop/page.tsx          # Coin Store + Premium Store
  wallet/page.tsx        # Balance display
  badges/page.tsx        # Badge collection
  profile/page.tsx       # User profile + avatar editor
  settings/page.tsx      # Preferences
  login/page.tsx         # Auth (email/password, 3-step signup)
  onboarding/page.tsx    # 4-step new user wizard
  demo/page.tsx          # Public quiz demo (no login)
  home/page.tsx          # Landing page (unauthenticated)
  about/ contact/ privacy/ terms/  # Static pages
components/              # Shared UI (Navbar, QuizCard, ProtectedRoute, etc.)
lib/                     # Core logic
  auth.tsx               # Auth context (login, signup, logout, session)
  db.ts                  # All Supabase queries + business logic
  hooks.ts               # SWR hooks (useUserStats, useStreakInfo)
  supabase.ts            # Supabase client init
  cdn.ts                 # cdnUrl() helper for static images
  sanitize.ts            # XSS/SQL injection prevention
  mockData.ts            # Constants (XP_PER_LEVEL, SUBJECT_ICONS, formatCoins)
  utils.ts               # cn(), shuffleArray(), formatTime()
questions/               # JSON question bank (math, science, history, social)
scripts/                 # Seed scripts (seed-questions.ts, auto-generate-questions.ts)
docs/                    # PROJECT.md, TEAM.md, ARCHITECTURE.md, FEATURES.md, THEME.md, etc.
```

### Key Architectural Patterns

- **ProtectedRoute wrapper:** Guards authenticated pages; checks onboarding status; self-heals missing profile rows for OAuth users
- **Auth context (`lib/auth.tsx`):** Provides `useAuth()` hook with user, session, login/signup/logout/refreshUser
- **Shared SWR hooks:** All pages use the same `useUserStats(userId)` hook -- no separate Supabase fetches per page
- **Input sanitization (`lib/sanitize.ts`):** All user inputs run through sanitizers before DB operations
- **Anti-cheat:** `getQuizQuestions()` returns questions WITHOUT `correct_answer`; `checkAnswer()` is called per-question server-side
- **Pages are single long files** -- not decomposed into many small components
- **Staggered animations:** All page content uses `animate-slide-up` with incrementing `animationDelay`
- **Background profile sync:** After login, profile data syncs in background (non-blocking)

### Navigation Structure

| Element | Details |
|---------|---------|
| Top nav tabs | Dashboard, Learn, Compete |
| CTA button | "Clock In" -- routes to `/quiz` |
| Avatar dropdown | Profile, Badges, Wallet, Settings, Help, Log Out |
| Mobile bottom nav | Home, Learn, Compete |

### Page Roles (No Feature Duplication)

- **Dashboard** = "How am I doing?" -- stats, progress, insights
- **Learn** = "How do I improve?" -- quiz, subjects, practice, AI study
- **Compete** = "How do I prove myself?" -- duels, arena, leaderboard, tournaments

---

## Database Schema (Supabase PostgreSQL)

### Core Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User data: username, display_name, avatar_url, bio, coins, xp, streak, max_streak, level, education_level, study_goal, selected_subjects, daily_target, onboarding_completed, is_public, show_on_leaderboard, is_online, last_seen, arena_elo |
| `questions` | Question bank: subject, topic, difficulty, question text, options (JSON), correct_answer, coin_reward, explanation |
| `quiz_sessions` | Quiz attempts: user_id, subject, total_questions, correct_answers, coins_earned, xp_earned, completed_at |
| `user_answers` | Per-question records: quiz_session_id, question_id, selected_answer, is_correct, time_taken, points_earned |
| `daily_activity` | Daily engagement: user_id, date, questions_answered, coins_earned, streak_maintained |
| `coin_transactions` | Fangs audit log: user_id, type (quiz_reward/duel/bounty/purchase), amount, related_id |

### Gamification Tables

| Table | Purpose |
|-------|---------|
| `badges` | Badge definitions: name, icon, rarity (common/rare/epic/legendary), description |
| `user_badges` | Earned badges: user_id, badge_id, unlocked_at |
| `achievements` | Achievement tracking: achievement_key, criteria |
| `bounties` | Daily/weekly reward quests: title, description, reward_coins, criteria, expires_at |
| `user_bounties` | User bounty progress: user_id, bounty_id, progress, claimed |
| `daily_bets` | Performance betting: user_id, coins_staked, target_score (7-10), multiplier, won |

### Competitive Tables

| Table | Purpose |
|-------|---------|
| `duels` | Casual 1v1: challenger_id, opponent_id, subject, coins_wagered, winner_id, scores |
| `arena_matches` | Ranked 1v1: player IDs, scores, wager, elo_before/elo_after per player |
| `arena_answers` | Per-answer in arena: user_id, question_id, is_correct, response_time_ms, points_earned |
| `arena_queue` | Matchmaking queue: user_id, elo, wager_range |
| `arena_challenges` | Direct challenges: challenger_id, challenged_id, wager, expires_at |

### Social Tables

| Table | Purpose |
|-------|---------|
| `friendships` | Friend relations: user1_id, user2_id, status (pending/accepted) |
| `messages` | Direct messages: sender_id, receiver_id, content, read |
| `social_notifications` | Activity alerts: type, title, message, read, action_url |

### Shop Tables

| Table | Purpose |
|-------|---------|
| `user_inventory` | Owned items: user_id, item_id, quantity, equipped |
| `purchase_history` | Purchase log: user_id, item_id, currency (fangs/usd), price |
| `active_boosters` | Active boosters: user_id, booster_id, effect, value, expires_at |

### Learning Path Tables

| Table | Purpose |
|-------|---------|
| `learning_paths` | Path definitions: name, subject, stages (JSON) |
| `user_stage_progress` | Stage progress: user_id, path_id, stage, stars (0-3), best_score |

---

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/save-quiz-results` | POST | 9-step quiz completion (session + answers + coins + xp + streak + transactions + achievements + bounties + bets) |
| `/api/auth/record-attempt` | POST | Log login attempt for brute-force tracking |
| `/api/auth/check-lock` | GET | Check if account locked (5+ failures in 15 min) |
| `/api/change-username` | POST | Username change (365-day cooldown) |
| `/api/place-bet` | POST | Daily bet on quiz score target |
| `/api/claim-bounty` | POST | Claim bounty reward |
| `/api/shop/purchase` | POST | Buy cosmetics or boosters with Fangs |
| `/api/shop/equip` | POST | Equip cosmetic item |
| `/api/shop/activate-booster` | POST | Activate booster (streak shield, etc.) |
| `/api/arena/queue` | POST | Join matchmaking queue |
| `/api/arena/match` | POST | Get or create arena match |
| `/api/arena/challenge` | POST | Challenge specific opponent |
| `/api/arena/answer` | POST | Submit arena answer |
| `/api/arena/complete` | POST | Finalize arena match, resolve ELO |
| `/api/social/friends` | GET | Get friend list |
| `/api/social/search` | POST | Search users |
| `/api/social/messages` | POST | Send message |
| `/api/games/pdf` | POST | Extract study content from PDF upload |
| `/api/games/reward` | POST | Award Fangs for mini-game completion |
| `/api/notifications` | GET | Fetch user notifications |
| `/api/contact` | POST | Contact form submission |
| `/api/waitlist` | POST | Waitlist signup + welcome email |

---

## Features -- Detailed

### Coin Economy (Fangs)

| Action | Reward |
|--------|--------|
| Correct quiz answer | ~10 Fangs (scales with difficulty: easy 1x, medium 1.5x, hard 2x) |
| Quiz completion (10 questions) | ~100 Fangs total |
| Duel win | 2x wagered coins (winner: 750, loser: 100, tie: 200) |
| Arena win | Wager amount from loser |
| Badge unlock | +100 bonus Fangs |
| Bounty claim | 50-500 Fangs |
| Daily bet win | 1.5x-5x staked coins (targets: 7/10=1.5x, 8/10=2x, 9/10=3x, 10/10=5x) |
| Learning path stage | score x 5 + stars x 10 Fangs |
| Mini-games | Varies per game type (10-30 Fangs) |

### XP & Leveling

- XP earned per quiz completion (~50 XP)
- Learning paths: score x 20 + stars x 25 XP
- `XP_PER_LEVEL = 1000`
- Level = `floor(xp / 1000) + 1`

### Streak System

- Increments on first quiz per calendar day
- Resets after 36+ hours of inactivity (unless Streak Shield booster active)
- Max streak tracked separately for lifetime records
- Visual fire animation intensifies at streak >= 7

### Daily Betting

- Users wager Fangs on their quiz performance before starting
- Target score options: 7, 8, 9, or 10 correct out of 10
- Multipliers: 1.5x, 2x, 3x, 5x
- Auto-resolved after quiz completion

### Quiz System

- 10 questions per session, 15-second timer per question
- 8 subject categories: Math, Science, Languages, Humanities, Tech & Coding, Cloud & IT, Finance & Business, Test Prep
- 3 difficulty levels: beginner, intermediate, advanced
- Coin burst particle animation on correct answers
- Explanation shown after each question
- Boosters can modify rewards (2x coins, 2x XP, extra time, 50/50, streak shield)

### AP Exams

- 10 AP subjects: Biology, Chemistry, US History, World History, Calculus AB, English Language, Psychology, Macroeconomics, Physics, Statistics
- Best score tracking per subject
- Accuracy progress bars

### Learning Paths

- 4 subjects: Algebra, Biology, US History, Chemistry
- Sequential stages that unlock progressively
- Star system (0-3 stars based on score: 90%+=3, 70%+=2, 50%+=1)
- 5 questions per stage, 30-second timer
- Replayable for better scores

### 1v1 Duels (Casual)

- Select opponent and subject
- 10 shared questions, 15 seconds each
- Coin wager (10-100)
- Winner takes 2x; speed bonus for fast answers
- Currently simulated opponents (68% accuracy, random delay)

### Arena (Ranked)

- ELO-based matchmaking (starts ~1200)
- Wager selection: 10, 25, 50, 100 coins
- Speed-based scoring (faster = higher points)
- Direct challenges to specific opponents (5-min expiry)
- Uses Supabase Realtime for live match updates
- **ELO tiers:** Bronze (0-1199), Silver (1200-1399), Gold (1400-1599), Platinum (1600-1799), Diamond (1800+)

### Compete Tiers (Win-Based)

| Tier | Wins | Tagline |
|------|------|---------|
| Bronze | 0-99 | Freshman |
| Silver | 100-249 | Scholar |
| Gold | 250-499 | Honor Roll |
| Platinum | 500-999 | Dean's List |
| Diamond | 1,000-1,999 | Valedictorian |
| Onyx | 2,000-3,499 | Prodigy |
| Ruby | 3,500-4,999 | Olympiad |
| Emerald | 5,000-7,499 | Mastermind |
| Legend | 7,500+ | Immortal |

Monthly prize pool: 50,000 Fangs split among top 20 players.

### Leaderboard

- Weekly reset (every Sunday midnight)
- Ranked by coins earned this week (quiz rewards only)
- Podium display for top 3
- All-time rankings available

### Mini-Games (`/games`)

| Game | Daily Limit | Reward | Description |
|------|------------|--------|-------------|
| Roardle | 3 plays | 10-20 + bonus Fangs | Wordle-style word guessing (4-6 letter words) |
| Blitz Sprint | 5 plays | correct x 2 Fangs | 60-second speed round Q&A |
| Flashcards | Unlimited | % known x 15 Fangs | 12 cards per session, mark knew/didn't know |
| Timeline Drop | 3 plays | correct x 3 Fangs | Sequence events chronologically |

All games support **PDF upload** -- users can upload study materials and the AI generates game content from them.

### Shop (The Lion's Den)

**Coin Store (Fangs):**
- Cosmetics: avatar frames (25-500F), name colors (20-450F), banners (15-750F)
- Rarity tiers: common, rare, epic, legendary
- Boosters: Coin Rush 2x (75F), XP Surge 2x (75F), Streak Shield (150F), Double Down (200F), Brain Freeze/50-50 (125F), and more
- Bulk buy: 5x at 10% discount

**Premium Store (USD, Coming Soon):**
- Diamond Crown Frame: $4.99
- Holographic Name: $1.99
- Phoenix Rising Banner: $4.99
- Stripe integration wired but not live

### Social

- Friend requests (mutual following)
- Direct messaging
- Online status (real-time presence)
- Arena event feed (friend match results)
- Social notifications

### Profile & Badges

- DiceBear avatar customization (10 styles, skin tones, hair, colors)
- Badge collection with rarity glow effects
- Public/private profile toggle
- Username change (once per 365 days)
- Stats: level, XP, coins, streak, accuracy %, duels won, questions answered

---

## Security

- **Input sanitization:** All inputs through `lib/sanitize.ts` (XSS, SQL injection, script tag detection)
- **Brute-force protection:** 5 failed login attempts locks account for 15 minutes
- **Session timeout:** 2-hour inactivity auto-logout (localStorage timestamp)
- **Security headers:** CSP, HSTS, X-Frame-Options (via middleware, currently disabled)
- **Anti-cheat:** Questions served without answers; answer validation server-side
- **Reserved usernames:** admin, root, lionade, support, help, ninny

---

## Theme & Styling

### Dark Theme (Default)

| Token | Value | Use |
|-------|-------|-----|
| bg-page | #04080F | Page background (deep navy) |
| bg-card | #0a1020 | Card/panel backgrounds |
| electric | #4A90D9 | Primary actions, links |
| gold | #FFD700 | Rewards, highlights, CTAs |
| cream | #EEF4FF | Primary text |
| success | #2ECC71 | Correct answers |
| danger | #E74C3C | Wrong answers, warnings |

### Light Theme

| Token | Value | Use |
|-------|-------|-----|
| bg-page | #FFFBF0 | Page background (warm cream) |
| text | #1a1a1a | Primary text |
| cards | white | Card backgrounds |

### Glassmorphism Pattern

```
bg-white/5 backdrop-blur border border-white/10 rounded-2xl
```

### Animation Rules

- All animations must respect `prefers-reduced-motion`
- CSS-only keyframes in `globals.css` (no JS animation libraries required)
- Key animations: `slide-up`, `coin-fly`, `pulse-glow`, `streak-fire`, `shimmer`, `xp-fill`
- Component classes: `btn-gold`, `btn-outline`, `btn-primary`, `card`, `tilt-card`

---

## Question Bank

### Structure

```
questions/{subject}/{topic}-{difficulty}{number}.json
```

### Current Coverage

- **Math:** Algebra, Geometry, Calculus, Statistics, Trigonometry (beginner/intermediate/advanced, 37+ files)
- **Science:** Biology, Chemistry, Physics, Astronomy, Earth Science (17+ files)
- **History:** Global History (beginner/intermediate/advanced)
- **Social Studies:** Social Studies (beginner/intermediate/advanced)

### Question Format

```json
{
  "question": "What is the derivative of x^2?",
  "options": ["x", "2x", "x^2", "2"],
  "correct_answer": "2x",
  "explanation": "The power rule states d/dx(x^n) = nx^(n-1)",
  "subject": "math",
  "difficulty": "intermediate",
  "topic": "calculus"
}
```

### Seeding

- `npm run seed:questions` -- batch-inserts from JSON into Supabase
- Deterministic UUIDs (hash-based) prevent duplicates on re-run
- Batches of 50

---

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anon key |
| `SUPABASE_SECRET_KEY` | Server | Service role key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public | Stripe public key |
| `STRIPE_SECRET_KEY` | Server | Stripe secret key |
| `RESEND_API_KEY` | Server | Email service |
| `EMAIL_FROM` | Server | Sender address |
| `GEMINI_API_KEY` | Server | Google Gemini API |
| `GROQ_API_KEY` | Server | Groq API |
| `OPENAI_API_KEY` | Server | OpenAI API |
| `NEXT_PUBLIC_CDN_URL` | Public | CloudFront CDN base URL |

---

## Roadmap

| Phase | Target | Highlights |
|-------|--------|------------|
| **Private Beta** | Q1 2026 (current) | Core quiz, duels, leaderboard, shop, badges, arena |
| **V1 -- Public Launch** | Summer 2026 | All features open, full subject coverage, community features |
| **V2 -- Lionade Pro** | December 2026 | **Real cash payouts go live**, advanced analytics, premium subscription, exclusive tournaments |
| **V3 -- Full Vision** | March 2027 | Ninny AI study companion, team leagues, tutoring marketplace (users earn real money), 10% payout boost for early users |

### Coming Soon Features

- **Practice Sets:** Curated timed question batches
- **Study With Ninny:** AI-powered study assistant (upload materials, generate questions)
- **Reward Redemptions:** Convert Fangs to real prizes (V2)
- **Video Explanations:** Question walkthroughs
- **Flashcard Mode:** Spaced repetition learning
- **Study Groups:** Collaborative learning
- **Weekly Tournaments:** Structured competitive events

---

## Known Technical Debt

- Duel uses simulated opponents (68% accuracy) -- not real matchmaking yet
- Client-side `incrementCoins`/`incrementXP` in `lib/db.ts` is fetch-then-update (race condition risk)
- Quiz timer is client-side only -- no server validation of answer timing
- Leaderboard filter toggle (weekly/all-time) doesn't change data source
- `formatCoins`, level calc, subject icons/colors live in `lib/mockData.ts` (misnomer)
- Compete rank strip uses mock values
- Middleware (rate limiting + security headers) is currently disabled
- Rate limiting is in-memory (needs Redis for production)
- Supabase client typed as `any` to bypass broken PostgREST generics

---

## Critical Rules (from CLAUDE_AGENT.md)

1. **No flash-of-zero:** Stats init as `null`, show skeletons while loading
2. **SWR config:** Always use `keepPreviousData: true, revalidateOnFocus: true`
3. **Avatar stability:** Memoize DiceBear URLs with `useMemo`
4. **Fangs icon:** Always `<img src={cdnUrl("/F.png")} alt="Fangs" />` -- import `cdnUrl` from `@/lib/cdn`
5. **Currency name:** "Fangs" (never "coins" or "tokens" in UI)
6. **Tailwind only:** No separate CSS files
7. **Animations:** Must respect `prefers-reduced-motion`
8. **DB changes:** Always create migration file at `lib/migrations/00X_description.sql`
9. **Navigation:** All links must route to real pages (never `href="#"`)
10. **Do not modify** without explicit instruction: auth.tsx, supabase.ts, middleware.ts, sanitize.ts, database.sql, ProtectedRoute.tsx, Navbar.tsx, layout.tsx, .env.local
