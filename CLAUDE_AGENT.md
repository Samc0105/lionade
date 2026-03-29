# Lionade — Claude Agent Standing Instructions

**Read this file fully before starting any task.**

---

## 1. PROJECT OVERVIEW

Lionade is a competitive, gamified study rewards platform where students earn Fangs (currency), compete in duels, climb leaderboards, and unlock badges. Two sites exist:

- **Marketing site** — Coming soon landing page at `/` with hidden DevOps access gate (5-click copyright)
- **App** — Authenticated dashboard, learn hub, arena, social, games, shop, and more

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14.2.5, App Router (`app/`), all pages `"use client"` |
| Styling | Tailwind CSS, Framer Motion, `app/globals.css` for keyframes only |
| Auth | Supabase Auth (email/password + Google OAuth), wrapped in `lib/auth.tsx` |
| Database | Supabase PostgreSQL, queries in `lib/db.ts`, types in `types/supabase.ts` |
| Email | Resend API |
| Avatars | DiceBear API (adventurer style) |
| Icons | lucide-react |
| Data fetching | SWR |
| Deploy | Vercel (main branch = production) |

### Commands
```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```
No test framework is configured.

### Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase client (public)
- `SUPABASE_SECRET_KEY` — Supabase service role (server-only)
- `RESEND_API_KEY` / `EMAIL_FROM` — Email service

---

## 2. TEAM & WORKFLOW

- **Sam** pushes directly to `main`
- **Santy** and **Ethan** must use branches and submit PRs
- **SQL before code** — always run Supabase migrations before any Claude Code prompts that depend on schema changes
- **Commit after every change** — never push unless explicitly told to
- Never push broken builds to main
- Any Supabase schema change must be delivered as a migration file at `lib/migrations/00X_description.sql`

---

## 3. ARCHITECTURE

### App Structure
```
app/
  layout.tsx          — Root layout, fonts, global providers, navbar
  page.tsx            — Coming soon page + hidden DevOps access gate
  login/page.tsx      — Login + signup UI and validation
  onboarding/page.tsx — Multi-step onboarding flow
  dashboard/page.tsx  — Performance command center
  learn/page.tsx      — Learn hub (circle/bubble UI)
  compete/page.tsx    — Compete hub (rank strip + mode tiles)
  arena/page.tsx      — Arena mode
  quiz/page.tsx       — Quiz runtime, scoring, persistence
  duel/page.tsx       — Duel UX
  leaderboard/page.tsx— Rankings UI
  profile/page.tsx    — User profile, badges, stats, history
  social/page.tsx     — Social features
  games/page.tsx      — Mini-games
  shop/page.tsx       — Fangs shop
  badges/page.tsx     — Badge collection
  wallet/page.tsx     — Wallet / rewards
  settings/page.tsx   — User settings
  contact/page.tsx    — Help / support
  about/page.tsx      — About page
  demo/page.tsx       — Demo page
  home/page.tsx       — Home page
  privacy/page.tsx    — Privacy policy
  terms/page.tsx      — Terms of service
```

### Key Patterns
- **ProtectedRoute wrapper** (`components/ProtectedRoute.tsx`): Wraps authenticated pages, checks onboarding status, self-heals missing profile rows for OAuth users
- **Auth context** (`lib/auth.tsx`): Provides `user`, `isLoading`, `login`, `signup`, `logout`, `refreshUser` via `useAuth()` hook
- **Input sanitization** (`lib/sanitize.ts`): All user inputs go through sanitizers before DB operations. `isSuspicious()` checks for XSS/SQL injection patterns
- **Middleware** (`middleware.ts`): Rate limiting (in-memory, needs Redis for production) + security headers (CSP, HSTS, X-Frame-Options)
- **Pages are single long files** — not decomposed into many small components. Follow this pattern.
- **Staggered animations** — all page content uses `animate-slide-up` with incrementing `animationDelay`
- **Path alias** — `@/*` maps to project root

### Supabase Tables
Core: `profiles`, `questions`, `quiz_sessions`, `user_answers`, `daily_activity`, `duels`, `badges`, `user_badges`, `coin_transactions`, `login_attempts`

### Navigation
- **Nav tabs:** Dashboard | Learn | Compete (3 tabs only)
- **CTA "Clock In" button** in nav bar routes to /quiz
- **Avatar dropdown:** Profile, Badges, Wallet/Rewards, Settings, Help/Support, Log Out
- **Mobile bottom nav:** Home, Learn, Compete (replaces hamburger menu)
- All dropdown links must route to real pages — never leave `href="#"`

---

## 4. THEME REQUIREMENTS

Every new feature, page, or component must support both dark and light themes.

### Dark Theme (default)
- Background: deep dark navy/black `#04080F`
- Text: white and light grays `#EEF4FF`
- Accents: Lionade gold `#FFD700` (highlights/rewards), Electric blue `#4A90D9` (primary), Red `#EF4444` (Arena)
- Cards/panels: slightly lighter dark (`#0a1020` or similar)
- Borders: subtle dark borders (`rgba(255,255,255,0.06-0.1)`)
- Glassmorphism cards: `bg-white/5 backdrop-blur border border-white/10 rounded-2xl`

### Light Theme
- Background: warm white `#FFFBF0`
- Text: dark navy or black `#1a1a1a`
- Same gold and red accents
- Cards/panels: white with soft shadows
- Borders: light gray `#e5e5e5`

### Rules
- **Use CSS variables for all colors — never hardcode colors directly**
- Every component must look correct in both themes
- The dark theme is the primary/default theme
- Use `data-force-dark` attribute on sections that must stay dark in light mode (e.g. Arena, Compete)
- Use CSS classes instead of inline styles for backgrounds that need to survive theme switching
- No grid lines or busy patterns on backgrounds
- Aesthetic: Clean and modern (like Discord/Linear) — not cluttered or over-designed

### Fonts
- **Bebas Neue** (`font-bebas`) — headings
- **Syne** (`font-syne`) — body text
- **DM Mono** — monospace

### Animations
- CSS-only keyframes in `globals.css`
- All animations must respect `prefers-reduced-motion` — add new animation classes to the reduced-motion selector list at the bottom of `globals.css`
- Idle animations: `idle-float`, `idle-pulse`, `idle-tilt`, `idle-shimmer`, `idle-shimmer-bar`, `idle-glow-mission`, `idle-glow-ninny`

### Component Classes
`btn-gold`, `btn-outline`, `btn-primary`, `card`, `tilt-card`, `gold-text`, `glow-gold`, `animate-slide-up`

---

## 5. CODING RULES

### Before Starting Any Task
1. Read this file (CLAUDE_AGENT.md) fully
2. Self-check against every rule below before finishing

### No Flash of Zero
- Every stat (Fangs/coins, XP, streak, level, quizzes completed) must NEVER render `0` while loading
- Initial state must be `null`, not `0`
- Only render numbers when value `!== null`
- Show skeletons while loading: `<div className="bg-white/10 rounded animate-pulse w-8 h-4" />`

### SWR Config Standard
Every SWR call for user data must include:
```js
{ keepPreviousData: true, revalidateOnFocus: true }
```

### Avatar Stability
- Never reconstruct the DiceBear avatar URL on every render
- Always memoize: `const avatarUrl = useMemo(() => \`https://api.dicebear.com/...\`, [username])`
- Never use `key={Date.now()}` or any unstable key on image elements

### Shared Data Hook
- All pages and components must use the same shared SWR user hook
- Do not create separate Supabase fetches per page

### Fangs Icon
- Never use a moon emoji or generic coin emoji for the Fangs currency
- Always use: `<img src="/fangs.png" alt="Fangs" className="w-6 h-6 object-contain" />`

### Currency Naming
- The in-app currency is called **Fangs** (not coins, not tokens)
- The icon is `/public/fangs.png`
- Always refer to it as "Fangs" in UI copy

### Dependencies
- Before installing any new package, check `package.json` first
- Prefer using what's already installed: framer-motion, lucide-react, SWR, Tailwind

### Styling
- Use Tailwind for all styling
- `app/globals.css` is the only CSS file — used solely for keyframe animations and utility classes that Tailwind can't express
- Do not create separate CSS files

### General
- Be concise, don't show full file contents in responses
- The `.next` cache occasionally corrupts — `rm -rf .next` fixes webpack module errors

### Self-Check Before Marking Any Task Complete
- [ ] Did I initialize any stat as `0`? Change to `null`
- [ ] Did I add `keepPreviousData: true` to all SWR hooks?
- [ ] Did I memoize any avatar URLs?
- [ ] Did I use `/fangs.png` for the Fangs icon?
- [ ] Did I leave any `href="#"` in navigation?
- [ ] Did I create a migration file for any DB change?
- [ ] Does any new page match the Lionade aesthetic?
- [ ] Am I reusing the shared user data hook instead of making a new fetch?
- [ ] Does the component work in both dark and light themes?

---

## 6. FEATURE REGISTRY

### Auth & Onboarding
- Email/password + Google OAuth login/signup
- Multi-step onboarding flow
- Session expiry, brute force protection
- ProtectedRoute with self-healing profile rows for OAuth users

### Dashboard
- Command center layout: hero header, stat pills, XP bar, mission hero, continue shelf, Ninny's Notes
- Dynamic greeting by time of day
- Idle glow animations on mission card and Ninny's Notes
- CTA pulse on "Start Daily Quiz" button

### Learn
- Circle/bubble UI with 4 options: Daily Quiz, Subjects, Practice Sets, Study With Ninny (coming soon)
- Primary action hierarchy (Daily Quiz bubble larger)
- Hover glow/scale effects, idle float animations
- Coming soon modals for unreleased features

### Quiz System
- Timed daily quiz flow with scoring and Supabase session persistence
- Subject-based question routing

### Arena / Compete
- Rank summary strip + 3 mode tiles (Duel, Blitz, Leaderboard)
- Weekly Tournament placeholder
- Duel flow with invite + simulated opponent
- Leaderboard page (weekly/all-time toggle)
- Idle tilt/pulse/shimmer animations on compete tiles

### Social
- Social features page

### Games
- Mini-games page with lion mascot

### Notifications
- In-app notification system

### Shop & Wallet
- Fangs shop for spending currency
- Wallet/rewards page

### Profile & Badges
- Profile page with overview, badges, stats, quiz history
- Badge collection page

### Settings
- User settings page

### Security
- Rate limiting middleware (in-memory)
- Input sanitization (XSS/SQL injection prevention)
- Security headers (CSP, HSTS, X-Frame-Options)

### Other Pages
- About, Contact/Help, Privacy Policy, Terms of Service, Demo

---

## 7. QUESTION BANK

### Directory Structure
```
questions/
  math/
    math-{difficulty}-{topic}{number}.json
  science/
    {topic}-{difficulty}{number}.json
```

### Subjects Seeded
- **Math:** algebra, geometry, calculus, statistics, trigonometry (beginner, intermediate, advanced)
- **Science:** biology, chemistry, physics, earth-science, astronomy (beginner, intermediate, advanced)

### File Naming Convention
- Math: `math-beginner-algebra1.json`, `math-intermediate-geometry2.json`, `math-advanced-calculus1.json`
- Science: `biology-beginner1.json`, `chemistry-advanced1.json`, `earth-science-intermediate1.json`

### Seed Scripts
- `scripts/seed-questions.ts` — Seeds all questions from the `questions/` directory into Supabase. Run with `npx tsx scripts/seed-questions.ts`
- `scripts/seed-science.ts` — Seeds science questions only (skips astronomy). Run with `npx tsx scripts/seed-science.ts`
- `scripts/auto-generate-questions.ts` — Auto-generates question files
- Both scripts read credentials from `.env.local` and batch-insert in groups of 50

---

## 8. DO NOT TOUCH

The following files and systems should never be modified without explicit instruction:

| File / System | Reason |
|---------------|--------|
| `lib/auth.tsx` | Auth context — changes break all authenticated pages |
| `lib/supabase.ts` | Supabase client init — changes break all DB operations |
| `lib/supabase-server.ts` | Server-only admin client — security-sensitive |
| `middleware.ts` | Rate limiting + security headers — changes affect all routes |
| `lib/sanitize.ts` | Input sanitization — changes could introduce XSS/SQL injection |
| `lib/database.sql` | Full Supabase schema — use migration files instead |
| `lib/migrations/*` | Existing migrations — create new ones, don't edit old ones |
| `components/ProtectedRoute.tsx` | Route protection + onboarding — changes break auth flow |
| `components/Navbar.tsx` | Global nav — changes affect every page |
| `app/layout.tsx` | Root layout — changes affect the entire app |
| `.env.local` | Secrets — never commit or modify |
| `types/supabase.ts` | Auto-generated types — regenerate, don't hand-edit |

---

## Known Bug Patterns
- Stats initializing as `0` instead of `null` — causes flash-of-zero on load/tab return
- Avatar `src` changing on every render — causes image hard reload
- SWR hooks missing `keepPreviousData` — data reverts to 0 during revalidation
- New pages doing their own Supabase fetch instead of using the shared hook — causes duplicate fetches and inconsistent state
- `href="#"` left on nav items — broken navigation
- **White screen on new pages**: The old ThemeProvider `fixInlineBackgrounds` function has been REMOVED. Do NOT re-add it. Light theme is handled entirely by CSS `html.light` selectors.
- **Corrupted .next cache**: Run `rm -rf .next` if you see "Cannot find module" errors.
