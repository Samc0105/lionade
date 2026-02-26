# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lionade is a gamified study rewards platform (Next.js 14 App Router) where students earn coins, compete in duels, climb leaderboards, and unlock badges. Backend is Supabase (PostgreSQL + Auth). Deployed on Vercel.

## Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run lint     # ESLint
```

No test framework is configured.

## Rules

- Always commit locally, do NOT push unless explicitly told to
- Be concise, don't show full file contents in responses
- Use Tailwind for styling — `app/globals.css` is the only CSS file, used solely for keyframe animations and utility classes that Tailwind can't express
- Do not create separate CSS files

## Architecture

### Stack
- **Framework:** Next.js 14.2.5 with App Router (`app/` directory), all pages are `"use client"`
- **Auth:** Supabase Auth (email/password + Google OAuth), wrapped in `lib/auth.tsx` React Context
- **Database:** Supabase PostgreSQL, queries in `lib/db.ts`, types auto-generated in `types/supabase.ts`
- **Email:** Resend API for transactional emails
- **Avatars:** DiceBear API (adventurer style)

### Key Patterns
- **ProtectedRoute wrapper** (`components/ProtectedRoute.tsx`): Wraps authenticated pages, checks onboarding status, self-heals missing profile rows for OAuth users
- **Auth context** (`lib/auth.tsx`): Provides `user`, `isLoading`, `login`, `signup`, `logout`, `refreshUser` via `useAuth()` hook
- **Input sanitization** (`lib/sanitize.ts`): All user inputs go through sanitizers before DB operations. `isSuspicious()` checks for XSS/SQL injection patterns
- **Middleware** (`middleware.ts`): Rate limiting (in-memory, needs Redis for production) + security headers (CSP, HSTS, X-Frame-Options)

## Design Guidelines

- **Theme:** Dark space/interstellar with esports/gaming premium aesthetic
- **Base:** Deep navy-black (`#04080F`), no grid lines or busy patterns
- **Accents:** Gold `#FFD700` (highlights/rewards), Electric blue `#4A90D9` (primary), Cream `#EEF4FF` (text)
- **Aesthetic:** Clean and modern (like Discord/Linear) — not cluttered or over-designed
- **Fonts:** Bebas Neue (`font-bebas` for headings), Syne (`font-syne` for body), DM Mono (monospace)
- **Animations:** CSS-only keyframes in `globals.css`. All animations must respect `prefers-reduced-motion` — add new animation classes to the reduced-motion selector list at the bottom of `globals.css`
- **Component classes:** `btn-gold`, `btn-outline`, `btn-primary`, `card`, `tilt-card`, `gold-text`, `glow-gold`, `animate-slide-up`

### Database Tables
Core: `profiles`, `questions`, `quiz_sessions`, `user_answers`, `daily_activity`, `duels`, `badges`, `user_badges`, `coin_transactions`, `login_attempts`

### Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase client (public)
- `SUPABASE_SECRET_KEY` — Supabase service role (server-only)
- `RESEND_API_KEY` / `EMAIL_FROM` — Email service

## Conventions
- Pages are single long files (not decomposed into many small components) — follow this pattern
- All page content uses staggered `animate-slide-up` with incrementing `animationDelay`
- Path alias: `@/*` maps to project root
- The `.next` cache occasionally corrupts — `rm -rf .next` fixes webpack module errors
