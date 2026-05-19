# Changelog

All notable changes to Lionade, newest first.

---

## 2026-05-19
- feat(nav): sliding "limelight" bottom-nav highlight on web + iOS. Replaces the per-cell static gold pill with a single travelling backdrop that springs to the active tab.
  - **Web (`components/Navbar.tsx`):** framer-motion shared-layout — every bottom-nav `<Link>` conditionally renders a `motion.span layoutId="navLimelight"` backdrop + `layoutId="navLimelightBeam"` top beam only when active. Active state is pathname-driven (`isTabActive(item.href)`), so the DOM tree is invariant between SSR + first client render — no hydration risk. `useReducedMotion()` collapses to `{duration:0}`. Icon+label wrapped in a `<span className="relative z-10 flex flex-col items-center gap-0.5">` so the backdrop sits behind. Earlier session's `<Link><button>` → `<Link className>` hydration fix preserved.
  - **iOS (`app/(tabs)/_layout.tsx`):** one `Animated.View` limelight pill, position driven by `useSharedValue` + `withSpring({stiffness:320, damping:30, mass:0.9})` against `state.index * cellW`. `cellW` measured via `onLayout` (idiomatic RN). Removed the per-cell static `backgroundColor: focused ? ACCENT_BG : "transparent"`. `useReducedMotion()` collapses to `withTiming(target,{duration:0})`. Haptics + `tabPress`/`defaultPrevented` guard + a11y (`selected: true`, `accessibilityRole/Label`) preserved.
  - **Tokens reused:** both platforms reuse the existing `ACCENT_BG` / `ACCENT_BORDER` rgba(255,215,0,…) — zero new design tokens.
- chore(build): `next.config.js` adds `resolve.extensionAlias = { ".js": [".ts",".tsx",".js"], ".mjs": [".mts",".mjs"], ".cjs": [".cts",".cjs"] }` so webpack resolves the `@lionade/core` shared TS package's NodeNext `.js` imports back to `.ts` source. Fixes `Module not found: Can't resolve './http.js'` 500s on every route.
- chore(ios-build): `package.json` adds `@react-native/virtualized-lists@0.81.5` as a top-level dep. RN 0.81.5 ships it as a transitive but `metro.config.js` sets `resolver.disableHierarchicalLookup = true` (workspace setup) and Metro can't resolve nested transitive deps — surfaced as a red-screen import error in `Libraries/Lists/SectionList.js`. Hoisting it explicitly is the standard RN fix.

## 2026-05-17
- feat(ui): new reusable Lionade-themed `ClaimBanner` component + applied to all 4 real claim surfaces, plus a Free→Pro upgrade nudge. Multi-concern frontend feature; routed `design-ui-ux` → `design-copywriter` → `dev-frontend` → `design-accessibility` → `quality-code-reviewer` → `quality-docs-writer`.
  - **New `components/ClaimBanner.tsx`** — one pure-presentational dismissible banner (no data/claim logic). Props: `variant` (gold/ember/electric/purple), `size` (pill/panel), `icon`, `eyebrow`, `title`, `description`, `meta`, `primaryAction` (href|onClick + disabled/loading), `secondaryAction`, `onDismiss`+`dismissLabel`, `children` slot, `role`, `ariaLabel`. framer-motion enter (`initial/animate` values) + restrained `whileHover/whileTap` micro-anim, `useReducedMotion()` honored. `cn` from `@/lib/utils`, phosphor `X` for dismiss. Lionade tokens only (gold #FFD700 / purple #7C3AED / electric #4A90D9 / ember #EF4444) — no boilerplate #005FF2. Hydration-safe: SSR element tree === first client render (no Math.random/Date/window/document at render; conditional sub-nodes branch on deterministic props only).
  - **Shell-only swap on 4 surfaces** (all claim logic/hooks/handlers/in-progress SWR changes preserved byte-for-byte — verified: zero +/- diff lines on any logic line): `components/DailyReadyNudge.tsx` (gold pill — only change: `setDismissed` moved inline-onClick→`onDismiss` prop, same handler), `components/StreakReviveBanner.tsx` (ember panel — `/api/streak-revive` SWR, `claim()` async, sessionStorage dismiss, `Countdown` helper, dual Fangs/$0.99 buttons via `children` slot all intact), `components/ClockInButton.tsx` (only the in-`HistoryPopover` "Ready now" claim block → gold pill; navbar `clock-in-btn`, `claim()`, `/api/login-bonus`, `HistoryPopover`/`ClockInReveal`, cooldown tile untouched), `components/DailyDrillWidget.tsx` (active "ready" prompt → electric panel inside the existing trigger `<button>`; completed branch + `DrillModal`/`submitFinalSelected`/`/complete` engine untouched).
  - **New `components/ProUpgradeNudge.tsx`** — Free→Pro nudge, single mount on `app/dashboard/page.tsx` in the existing nudge band (after `<StreakReviveBanner />`, before `<DailyDrillWidget />`). Plan detection via the canonical `usePlan()` (`@/lib/use-plan`, reads `profiles.plan`, fail-closed); renders ONLY for `plan === "free"` (hidden for paid, while loading, signed-out, or dismissed). CTA → `/pricing`. Copy facts from `lib/mastery-plan.ts`: 1.5× Fangs, 3 Mastery exams, no popup ads, $6.99/mo.
  - **a11y:** persistent nudges use `role="region"` (no re-announce), StreakRevive keeps `role="status"` (time-critical). Distinct dismiss `aria-label`s, no button-in-button, reduced-motion ✓. **Zero new deps** (no lucide-react; framer-motion-only; phosphor for X; package.json/lock untouched). `npx tsc --noEmit` clean; `/dashboard` + `/pricing` serve 200. Nothing committed.
- perf(nav): migrate ~8 raw-fetch pages to the existing global persistent SWR cache so in-app navigation is instant instead of cold-refetch + empty flash. Web architecture/perf refactor — **data-fetch mechanism only**, zero UI/logic/copy change. Followed `dev-performance` audit (no re-audit); routed `dev-frontend` → `quality-qa-tester` → `quality-code-reviewer` → `quality-docs-writer`.
  - **Shared hooks:** added `useSubjectStats`, `useQuizHistory`, `useAllBadges`, `useUserBadges`, `useWeeklyLeaderboard`, `useEloLeaderboard` to `lib/hooks.ts` — thin SWR wrappers over the **unchanged** `lib/db.ts` functions, stable string keys mirroring the existing `user-stats/${userId}` convention, deduped app-wide via the global `<SWRConfig>` provider. Near-static data gets long `dedupingInterval` (badges 5min; leaderboards/user-badges 30–60s).
  - **P0 — raw fetch → SWR (no behavior change):** `app/dashboard/page.tsx` (14 uncached calls + the bespoke `lionade_dash_*` sessionStorage cache **deleted** — the global localStorage SWR provider supersedes it; optimistically-mutated state — userBounties/activeBet/dailyMissions — kept as `useState` hydrated via SWR `onSuccess` so claim/bet mutations survive revalidation; `/api/bounties/rotate` side-effect + chart-fill timing preserved). `app/learn/page.tsx` (shared `useQuizHistory(60)` + page-local missions key; heatmap/mastery `useMemo` deps untouched). `app/social/page.tsx` (the 5 manual `setInterval`s → SWR `refreshInterval` 10s/30s/60s/15s; `loadFriends/loadFeed/loadNudgeBudget/loadSocialNotifs/loadMessages` kept as `mutate`-backed revalidators so every imperative call site is unchanged; realtime/optimistic message state + unread side-effect preserved; pre-existing `cacheSocial` left intact — out of audit scope for social). `app/profile/page.tsx` (badges/stats bundle → shared hooks with the *lifetime* subject-stats variant + 30-row history; redundant `profiles select *` narrowed to the 4 columns the edit form actually consumes and SWR-cached — wholesale removal would have regressed the bio/education/goal prefill since those aren't on `useAuth().user`, so behaviour-preservation took precedence over the literal "delete it" directive; `username_changes` SWR-cached; background `refreshUser()` preserved). `app/badges/page.tsx`, `app/leaderboard/page.tsx` (filter behaviour + elo row normalization preserved exactly), `app/wallet/page.tsx`, `app/quiz/page.tsx` — all migrated to SWR with stable keys.
  - **P2 — internal `<a href>` → `next/link` `<Link>`** (kills full reloads): `app/leaderboard/page.tsx`, `app/profile/page.tsx` (Browse Themes → /shop), `app/compete/page.tsx` (Blitz card → /games), `app/page.tsx` (ENTER BETA → /home; added `next/link` import). In-page hash anchors (`app/page.tsx` `#how-it-works`, Navbar hash anchors) and the login `window.location.assign` workaround intentionally **left as-is**.
  - **P3 — quick wins:** `app/academia/page.tsx` onboarding-gate `useSWR` gained `keepPreviousData:true` (no loading-branch flash on re-entry); `components/Navbar.tsx` `avatarUrl` memoized with `useMemo` (mirrors `app/profile/page.tsx`) to keep `<img src>` referentially stable (no avatar hard-reload on tab return).
  - **Untouched (verified-correct infra, no churn):** `lib/swr-config.ts`, `components/SwrProvider.tsx`, `components/ProtectedRoute.tsx`, `lib/auth.tsx`, `components/PageTransition.tsx`, `app/layout.tsx`. No new ad-hoc cache layers introduced — the global provider is the single cache. `npx tsc --noEmit` clean; all scoped routes serve 200.
  - **iOS:** **no parity row** — this is a web-only data-fetch/architecture refactor with no user-facing feature surface; iOS SWR/data-cache layer was separately audited 2026-05-13 (`@lionade/core` hooks) and is already exemplary, so there is nothing to port and a row would be spurious. Reasoning recorded in `IOS_PARITY.md`.


## 2026-05-15
- feat(pricing): premium glassy redesign of revenue-critical `app/pricing/page.tsx` (visual shell only).
  - **Web:** deep glass plan cards (gradient ring on Pro = gold "Most Popular", silver/electric ring on Platinum), segmented monthly/annual toggle, large Bebas numerals, restored `#faq` deep-link anchor. New page-local `components/PricingShader.tsx` — raw WebGL (no new deps), Lionade-recolored (navy `#04080F` -> electric `#4A90D9` -> sparse gold `#FFD700`, no hue cycling), scoped to /pricing only (NOT in layout, does not alter global SpaceBackground elsewhere). Theme-detect via `html.light` (Lionade has no `.dark` class); `prefers-reduced-motion` skips WebGL/rAF entirely and renders a static Lionade gradient. Full GL/observer/rAF cleanup on unmount.
  - **Logic preserved:** all `PLAN_PRICING`/`PLAN_EXAM_LIMITS`/`PLAN_FANG_MULTIPLIER`/`PLAN_ADS` bindings, the cycle toggle, the annual `price/12` math, and every mailto upgrade CTA unchanged — no revenue regression. Fixed two pre-existing a11y defects (mislabeled CompareRow ad-row aria-labels; missing FAQ anchor).
  - **iOS:** pricing redesign NOT in this pass — tracked as pending follow-up in `IOS_PARITY.md`.
- feat(nav): consistent route-based "Back to {Parent}" affordance on every non-root screen, cross-platform.
  - **Web:** extended `components/BackButton.tsx` `PARENT_PATHS`/`PARENT_LABELS` + dynamic-route regexes for `/learn/mastery`, `/learn/mastery/[examId]`, `/classes`, `/classes/[id]`, `/study-dna`. Added/standardized `<BackButton/>` on `learn/mastery`, `learn/mastery/[examId]`, `classes`, `classes/[id]`, `study-dna` (replaced ad-hoc Phosphor breadcrumbs; fixed study-dna pointing at the wrong parent). Roots (`/academia`, `academia/onboarding` funnel) intentionally excluded.
  - **iOS:** new shared `components/BackButton.tsx` mirroring web's semantic-parent behavior (NOT history). Applied to all 21 pushed/non-tab screens, replacing ~21 inconsistent ad-hoc disc/chevron back controls (3 local `BackButton` copies + `BackChip` deleted). Tab screens unchanged; native swipe-back preserved. `edit-profile` keeps its unsaved-changes discard guard; `arena`/`duel`/`quiz` in-match abandon controls left intact.
  - iOS parity tracked in `IOS_PARITY.md`.

## 2026-03-29
- `c3f7fa6` — docs: reorganize CLAUDE_AGENT.md into clean sections

## 2026-03-22
- `cc9631f` — fix: remove eye overlays from lion mascot
- `3b81846` — fix: resolve hooks violation on games page
- `4b4a873` — design: new transparent lion image and larger game cards
- `038f97d` — design: diagonal lion-centered games page with electric card animations
- `e842982` — design: animated cursor-tracking lion and games page redesign
- `5cd2924` — fix: permanent solution for white screen crashes on new pages
- `8c4c214` — feat: Games tab with Roardle, Blitz Sprint, Flash Cards, Timeline Drop and PDF upload
- `3a868d3` — fix: resolve hydration crashes and add error boundaries
- `23fc324` — fix: restore interstellar background after overscroll fix
- `2a39ed6` — fix: permanently hide savanna and fix /home page in light mode
- `7b6503d` — fix: restore sakura for light mode, fix /home page blank screen
- `0f2b787` — fix: restore finger scrolling while keeping overscroll background
- `0824387` — fix: hide savanna background that bleeds through in light mode
- `b2f50eb` — docs: add theme requirements to CLAUDE_AGENT.md
- `ec452be` — fix: remove overscroll blank space globally
- `34ff36e` — design: wave color animation on Duel Arena title

## 2026-03-20
- `2f7c982` — fix: resolve white screen crash when navigating between pages
- `de288d6` — feat: real-time notifications system with bell icon
- `2d7ac6a` — feat: live username search for adding friends
- `24378e8` — feat: social tab with friends and messaging
- `1df9eec` — fix: use CSS class for layout background instead of inline style
- `f34bfaa` — fix: add background to layout content wrapper for light mode
- `ce53f94` — fix: restore arena page after broken animation
- `f26ef3f` — design: subtle glint animation on Duel Arena title
- `642682a` — fix: force dark background on all arena phases for light mode
- `b10b3b9` — design: arena title shimmer every 20 seconds
- `1f01099` — design: red shimmer effect on Duel Arena title
- `6b23bec` — design: animated flashing title for Duel Arena
- `6128f6c` — design: premium arena page redesign
- `afbd3d4` — fix: restore compete page after arena build
- `d21e0e7` — feat: build full 1v1 Duel Arena with real-time competitive battles

## 2026-03-19
- `96af087` — fix: force logout if inactive for 2+ hours across sessions

## 2026-03-17
- `72b6ab3` — feat: GitHub Actions auto question generation
- `bcb8ea1` — feat: auto logout after 2 hours of inactivity

## 2026-03-14
- `a051fc8` — chore: reorganize question files into subject folders
- `f0f0db4` — feat: seed science questions into Supabase
- `767f7dc` — fix: prevent existing users from being redirected to onboarding
- `9e7952c` — fix: remove radial gradient blobs from home page background
- `473122e` — fix: force gold headings and light text on coming soon page
- `21ddb72` — fix: standardize all text colors on coming soon page
- `35af4bd` — fix: dark navbar, white text headings, dark sub-cards
- `11ecc46` — fix: force dark cards on coming soon page
- `72c84e4` — fix: skip onboarding for existing users, force dark mode on pre-auth pages
- `f6928c3` — fix: replace placeholder logo with actual lion icon on login page
- `486592c` — revert: restore full marketing coming soon page
- `14e279c` — Remove auth dependency from coming soon page
- `b577975` — Fix middleware redirect loop and white background flash
- `c584f30` — Add coming-soon maintenance mode redirect

## 2026-03-11
- `dd0fe4d` — Fix TypeScript build error: wrap matchAll in Array.from
- `9405141` — Replace spring/sakura light theme with savanna theme, fix expired streak reset

## 2026-03-07
- `7654b10` — Rewrite theme system with CSS variables, remove all !important overrides
- `a1b6b08` — Add fangs.png coin icon to public assets
- `8483e38` — Make coin pill clickable and link to /wallet

## 2026-03-06
- `eac9de9` — Add light mode spring/sakura theme
- `bec5622` — Replace coin emoji with fangs.png, redesign profile dropdown, add badges/wallet/settings pages
- `51b9d67` — Add streak popup modal, 36-hour streak system, fix stat flash-of-zero
- `93c8b1d` — Fix avatar flicker on tab switch with SWR cache
- `6001eb4` — Fix tab-switching flicker by layering SWR cache over auth context
- `8720fa1` — Merge branch 'santy/personalisation'
- `a2edd98` — Fix linter-duplicated CSS and JSX in shop page
- `12cf8a8` — Rebuild shop with Coin Store / Premium Store toggle
- `b7c7d0e` — Install Stripe packages
- `005c05c` — Fix shop: remove auth redirect, handle missing DB columns
- `92b42f3` — Add database migration for shop tables
- `2998647` — Integrate boosters into quiz flow
- `061d420` — Add shop API routes: purchase, equip, activate-booster
- `9ca51d0` — Add shop CSS animations: rarity glows, tilt cards, legendary borders
- `02afbe6` — Add Lion's Den shop page and Shop nav link

## 2026-03-05
- `00eff99` — Fix streak system: quiz-count based, cap daily progress

## 2026-03-04
- `fd9a64f` — Merge PR #2 from santy/personalisation
- `7c06bac` — Redesign theme cards, update light theme to soft blue
- `dd03507` — Merge PR #1 from santy/personalization
- `6479579` — Add functional preferences: light/dark theme, font scaling, compact layout

## 2026-03-01
- `086802c` — Remove Upload tab from Avatar & Appearance
- `a0dbae6` — Add username system: unique check, one change per year

## 2026-02-28
- `0c8fc82` — Update save-quiz-results to check bounty progress and resolve daily bets
- `a227cd2` — Add Daily Bet card with stake/target picker
- `f1a4ee0` — Add Bounty Board with daily/weekly bounties and claim API
- `d0ea130` — Remove Daily Quiz card from Continue section
- `42214a7` — Skip topic-less quiz sessions in Continue section
- `6c4345b` — Replace Continue carousel with static topic cards
- `17934ae` — Replace This Week placeholder with real leaderboard data
- `d692b90` — Show best score per subject in Your Subjects cards
- `f3a5a4b` — Show achievements grid on dashboard
- `36c4f81` — Add achievement system — check and award after each quiz
- `690b679` — Animate XP bar with blue-purple gradient
- `5508819` — Add streak fire animation with motivational banner
- `c6b0554` — Add daily progress bar showing questions answered
- `9cb226f` — Fix Recent Activity to show quiz sessions with scores
- `b4a0eeb` — Add coin burst animation on quiz results screen
- `42dc7c1` — Fix quiz_sessions FK constraint
- `6fe78a4` — Add SQL migration for missing gamification columns

## 2026-02-27
- `8d74cee` — Add server-side API route for quiz results to bypass RLS
- `6a71c85` — Fix refreshUser overwriting stats
- `175fc83` — Fix stats not updating: auth context was hardcoding coins/xp/streak to 0
- `60ee91d` — Redesign quiz results screen with glassmorphism
- `38b3089` — Wire quiz to real Supabase questions with anti-cheat
- `a4bf65b` — Remove all mock/hardcoded data, wire to real DB
- `412d32e` — Add question import script and import 1200 questions

## 2026-02-25
- `784b0b8` — Add enhanced deep space background
- `52740e1` — Apply global space/interstellar background
- `a2bb810` — Add global space background across all pages
- `9f64e37` — Redesign prize pool banner
- `6ba16ce` — Widen main content containers to max-w-7xl
- `ec27864` — Move community help note from /about to /contact
- `4848891` — Update /about page with full content
- `b3b7b40` — Replace gem sweep shimmer with breathing glow
- `99082d3` — Add gemstone images to ranking tier pyramid
- `c2a20b4` — Update ranking tier subtitles to academic theme
- `722d0b3` — Add logo image files
- `1351f50` — Add privacy, terms, and contact pages
- `fcf2695` — Add /about page, global footer
- `33357ff` — Add difficulty selector cards and answer explanations
- `1f352dc` — Fix demo timer auto-advance
- `12262cf` — Replace demo page logo with lion icon + animated text
- `5e8bf91` — Fix demo page content overlapping navbar
- `2709c13` — Add subtle glow and shimmer to navbar logo
- `63ee389` — Replace text logo with image logos in navbar

## 2026-02-24
- `936a0c7` — Fix auth persistence, onboarding redirect, profile self-heal
- `adb89bd` — Add onboarding flow, fix auth redirect, overhaul compete page

## 2026-02-23
- `e9f2e26` — Add category-based quiz selection with 8 topics

## 2026-02-22
- `4a778d4` — Redesign coming soon page

## 2026-02-21
- `c0d0916` — Redesign dashboard with circular stats and carousel
- `454a41b` — Redesign coming soon page with 3D visuals
- `b38a60b` — Coming soon landing page + gated product page + auth redirect
- `1f94bcb` — Add waitlist flow

## 2026-02-20
- `5043325` — Fix: remove duplicate CSP headers from next.config.js
- `12a6733` — UI + features pass: Dashboard, Learn with Ninny, Compete with rank strip
- `31000c9` — Nav + UI cleanup: slim nav, 3 tabs, avatar dropdown, mobile bottom nav
- `c3dc087` — Add security layers: rate limiting, sanitization, brute force, headers
- `4e13220` — Redesign profile page with sidebar layout and 8 sections
- `da9a8a6` — Improve signup and auth flow

## 2026-02-19
- `16dec58` — Add full Next.js app — Lionade beta
- `983474c` — Add hidden DevOps access to coming soon page

## 2026-02-18
- `c92bb6a` — Initial upload
