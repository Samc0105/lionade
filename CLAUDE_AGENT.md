# Lionade — Claude Agent Standing Instructions

**Read this file fully before starting any task.**

---

## Documentation Index

| Doc | What's Inside |
|-----|--------------|
| [docs/PROJECT.md](docs/PROJECT.md) | Project overview, tech stack, env vars, deployment |
| [docs/TEAM.md](docs/TEAM.md) | Sam/Santy/Ethan roles, workflow rules, PR process |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | App structure, Supabase tables, API routes, file naming |
| [docs/FEATURES.md](docs/FEATURES.md) | Every feature built with dates |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Running log of every change, newest first |
| [docs/THEME.md](docs/THEME.md) | Dark/light theme rules, CSS variables, color palette |
| [docs/QUESTION_BANK.md](docs/QUESTION_BANK.md) | Subjects, file naming, seed scripts, GitHub Actions |

---

## Non-Negotiables (Always Check)

### No Flash of Zero
- Stats must NEVER render `0` while loading — initial state = `null`, not `0`
- Show skeletons while loading: `<div className="bg-white/10 rounded animate-pulse w-8 h-4" />`

### SWR Config
Every SWR call for user data: `{ keepPreviousData: true, revalidateOnFocus: true }`

### Avatar Stability
- Memoize DiceBear URLs: `useMemo(() => \`https://api.dicebear.com/...\`, [username])`
- Never use `key={Date.now()}` on images

### Shared Data Hook
All pages use the same shared SWR user hook — no separate Supabase fetches per page.

### Fangs Icon
Always use: `<img src="/F.png" alt="Fangs" className="w-6 h-6 object-contain" />`
Currency is called **Fangs** (not coins, not tokens).

### Styling
- Tailwind only — `app/globals.css` is for keyframes and utilities Tailwind can't express
- No separate CSS files
- All animations must respect `prefers-reduced-motion`

### Dependencies
Check `package.json` before installing anything. Prefer: framer-motion, lucide-react, SWR, Tailwind.

### Database Changes
Any schema change = migration file at `lib/migrations/00X_description.sql`

### Navigation
All links must route to real pages — never leave `href="#"`

---

## Do Not Touch

These files should never be modified without explicit instruction:

| File | Reason |
|------|--------|
| `lib/auth.tsx` | Auth context — breaks all authenticated pages |
| `lib/supabase.ts` | Supabase client init — breaks all DB operations |
| `lib/supabase-server.ts` | Server-only admin client — security-sensitive |
| `middleware.ts` | Rate limiting + security headers |
| `lib/sanitize.ts` | Input sanitization — XSS/SQL injection prevention |
| `lib/database.sql` | Full schema — use migration files instead |
| `lib/migrations/*` | Existing migrations — create new, don't edit old |
| `components/ProtectedRoute.tsx` | Route protection + onboarding flow |
| `components/Navbar.tsx` | Global nav — affects every page |
| `app/layout.tsx` | Root layout — affects entire app |
| `.env.local` | Secrets — never commit |
| `types/supabase.ts` | Auto-generated — regenerate, don't hand-edit |

---

## Known Bug Patterns

- Stats init as `0` instead of `null` — flash-of-zero on load/tab return
- Avatar `src` changing every render — image hard reload
- SWR missing `keepPreviousData` — data reverts to 0 during revalidation
- New pages doing own Supabase fetch — duplicate fetches, inconsistent state
- `href="#"` on nav items — broken navigation
- **White screen**: ThemeProvider `fixInlineBackgrounds` was REMOVED. Do NOT re-add. Light theme uses CSS `html.light` selectors.
- **Corrupted .next cache**: `rm -rf .next` fixes "Cannot find module" errors

---

## Self-Check Before Completing Any Task

- [ ] Stats initialized as `null` (not `0`)?
- [ ] `keepPreviousData: true` on all SWR hooks?
- [ ] Avatar URLs memoized?
- [ ] `/F.png` used for Fangs icon?
- [ ] No `href="#"` in navigation?
- [ ] Migration file for any DB change?
- [ ] New pages match Lionade aesthetic?
- [ ] Using shared user data hook?
- [ ] Works in both dark and light themes?
