# Architecture

## App Structure

```
app/
  layout.tsx           — Root layout, fonts, global providers, navbar
  page.tsx             — Coming soon page + hidden DevOps access gate
  login/page.tsx       — Login + signup UI and validation
  onboarding/page.tsx  — Multi-step onboarding flow
  dashboard/page.tsx   — Performance command center
  learn/page.tsx       — Learn hub (circle/bubble UI)
  compete/page.tsx     — Compete hub (rank strip + mode tiles)
  arena/page.tsx       — Arena mode (1v1 duels)
  quiz/page.tsx        — Quiz runtime, scoring, persistence
  duel/page.tsx        — Duel UX
  leaderboard/page.tsx — Rankings UI
  profile/page.tsx     — User profile, badges, stats, history
  social/page.tsx      — Social features (friends, messaging)
  games/page.tsx       — Mini-games (Roardle, Blitz Sprint, etc.)
  shop/page.tsx        — Fangs shop (coin store + premium store)
  badges/page.tsx      — Badge collection
  wallet/page.tsx      — Wallet / rewards
  settings/page.tsx    — User settings (theme, font, layout)
  contact/page.tsx     — Help / support
  about/page.tsx       — About page
  demo/page.tsx        — Demo page
  home/page.tsx        — Home page
  privacy/page.tsx     — Privacy policy
  terms/page.tsx       — Terms of service
```

## Key Patterns

- **ProtectedRoute wrapper** (`components/ProtectedRoute.tsx`): Wraps authenticated pages, checks onboarding status, self-heals missing profile rows for OAuth users
- **Auth context** (`lib/auth.tsx`): Provides `user`, `isLoading`, `login`, `signup`, `logout`, `refreshUser` via `useAuth()` hook
- **Input sanitization** (`lib/sanitize.ts`): All user inputs go through sanitizers before DB operations. `isSuspicious()` checks for XSS/SQL injection patterns
- **Middleware** (`middleware.ts`): Rate limiting (in-memory, needs Redis for production) + security headers (CSP, HSTS, X-Frame-Options)
- **Pages are single long files** — not decomposed into many small components
- **Staggered animations** — all page content uses `animate-slide-up` with incrementing `animationDelay`
- **Path alias** — `@/*` maps to project root

## Navigation

| Element | Details |
|---------|---------|
| Nav tabs | Dashboard, Learn, Compete (3 tabs only) |
| CTA button | "Clock In" in nav bar, routes to `/quiz` |
| Avatar dropdown | Profile, Badges, Wallet/Rewards, Settings, Help/Support, Log Out |
| Mobile bottom nav | Home, Learn, Compete (replaces hamburger menu) |

All dropdown links must route to real pages — never leave `href="#"`.

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles, stats, preferences |
| `questions` | Question bank (all subjects/difficulties) |
| `quiz_sessions` | Quiz attempt records |
| `user_answers` | Individual answer records per session |
| `daily_activity` | Daily engagement tracking |
| `duels` | Duel match records |
| `badges` | Badge definitions |
| `user_badges` | Earned badges per user |
| `coin_transactions` | Fangs transaction ledger |
| `login_attempts` | Brute force protection tracking |

## API Routes

Server-side API routes live in `app/api/`:
- Quiz results saving (bypasses RLS)
- Shop purchase, equip, activate-booster
- Bounty claim
- Daily bet placement
- Waitlist signup (Resend email)

## File Naming Conventions

- **Pages:** `app/{route}/page.tsx`
- **Components:** `components/{PascalCase}.tsx`
- **Libraries:** `lib/{camelCase}.ts` or `lib/{camelCase}.tsx`
- **Migrations:** `lib/migrations/00X_description.sql`
- **Questions:** `questions/{subject}/{subject}-{difficulty}-{topic}{number}.json`
- **Types:** `types/{camelCase}.ts`
