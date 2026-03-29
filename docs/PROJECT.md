# Project Overview

## What is Lionade?

Lionade is a competitive, gamified study rewards platform where students earn Fangs (currency), compete in duels, climb leaderboards, and unlock badges.

### Two Sites
- **Marketing site** — Coming soon landing page at `/` with hidden DevOps access gate (5-click copyright)
- **App** — Authenticated dashboard, learn hub, arena, social, games, shop, and more

## Tech Stack

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

## Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```

No test framework is configured.

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anon key |
| `SUPABASE_SECRET_KEY` | Server-only | Supabase service role key |
| `RESEND_API_KEY` | Server-only | Resend email API key |
| `EMAIL_FROM` | Server-only | Sender email address |

## Deployment

- **Platform:** Vercel
- **Production branch:** `main`
- **Auto-deploy:** Every push to `main` triggers a Vercel build
- Never push broken builds to main
