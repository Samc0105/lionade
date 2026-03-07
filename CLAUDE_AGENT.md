# Lionade — Claude Agent Standing Instructions

You are working on **Lionade**, a competitive study rewards app. Next.js + Supabase + Tailwind CSS, deployed on Vercel. Before making any changes, read this file fully and self-check against every rule below.

---

## Stack
- **Frontend:** Next.js (App Router), Tailwind CSS, Framer Motion, SWR, lucide-react
- **Backend:** Supabase (PostgreSQL), Supabase Auth (Google OAuth + email/password)
- **Deploy:** Vercel (main branch = production)
- **Email:** Resend API
- **Avatars:** DiceBear

---

## Non-Negotiables — Always Check Before Finishing Any Task

### 1. No Flash of Zero
- Every stat (Fangs/coins, XP, streak, level, quizzes completed) must NEVER render `0` while loading
- Initial state must be `null`, not `0`
- Always guard: only render the number when value `!== null`
- All SWR hooks fetching user stats must have `keepPreviousData: true`
- If loading, show a skeleton: `<div className="bg-white/10 rounded animate-pulse w-8 h-4" />`

### 2. SWR Config Standard
Every SWR call for user data must include:
```js
{ keepPreviousData: true, revalidateOnFocus: true }
```

### 3. Avatar Stability
- Never reconstruct the DiceBear avatar URL on every render
- Always memoize: `const avatarUrl = useMemo(() => \`https://api.dicebear.com/...\`, [username])`
- Never use `key={Date.now()}` or any unstable key on image elements

### 4. Shared Data Hook
- All pages and components must use the same shared SWR user hook (do not create separate Supabase fetches per page)
- This ensures data is already cached when navigating between pages — no re-flash

### 5. Fangs Icon
- Never use a moon emoji 🌙 or generic coin emoji for the Fangs currency
- Always use: `<img src="/fangs.png" alt="Fangs" className="w-6 h-6 object-contain" />`
- Adjust size class to context but always use the image

### 6. Navigation — All Dropdown Links Must Route Somewhere Real
- Profile → `/profile`
- Badges → `/badges`
- Wallet / Rewards → `/wallet`
- Settings → `/settings`
- Help / Support → `/contact`
- Never leave `href="#"` or missing onClick handlers in nav items

### 7. New Pages Must Match Lionade Aesthetic
Any new page must:
- Use the dark space background (matching existing pages)
- Use glassmorphism cards: `bg-white/5 backdrop-blur border border-white/10 rounded-2xl`
- Pull user data from the shared SWR hook
- Never show raw `0` values while loading — use skeletons

### 8. No New Dependencies Without Checking
- Before installing any new package, check `package.json` first
- Prefer using what's already installed: framer-motion, lucide-react, SWR, Tailwind

### 9. Database Changes = Migration File
- Any Supabase schema change must be delivered as a migration file at `lib/migrations/00X_description.sql`
- Never modify the DB directly without a migration file

### 10. Git Discipline
- Sam pushes directly to `main`
- Santy and Ethan must use branches and submit PRs
- Never push broken builds to main

---

## Known Bug Patterns to Watch For
- Stats initializing as `0` instead of `null` → causes flash-of-zero on load/tab return
- Avatar `src` changing on every render → causes image hard reload
- SWR hooks missing `keepPreviousData` → data reverts to 0 during revalidation
- New pages doing their own Supabase fetch instead of using the shared hook → causes duplicate fetches and inconsistent state
- `href="#"` left on nav items → broken navigation

---

## Currency Naming
- The in-app currency is called **Fangs** (not coins, not tokens)
- The coin icon is `/public/fangs.png`
- Always refer to it as "Fangs" in UI copy

---

## Self-Check Before Marking Any Task Complete
Before finishing, ask yourself:
- [ ] Did I initialize any stat as `0`? Change to `null`
- [ ] Did I add `keepPreviousData: true` to all SWR hooks?
- [ ] Did I memoize any avatar URLs?
- [ ] Did I use `/fangs.png` for the Fangs icon?
- [ ] Did I leave any `href="#"` in navigation?
- [ ] Did I create a migration file for any DB change?
- [ ] Does any new page match the Lionade dark space aesthetic?
- [ ] Am I reusing the shared user data hook instead of making a new fetch?
