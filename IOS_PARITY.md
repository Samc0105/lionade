# IOS_PARITY.md — Web ↔ iOS Feature Drift Tracker

**Updated by `quality-docs-writer` after every shippable web change.**
**Web repo:** `~/Desktop/lionade` · **iOS repo:** `~/Desktop/lionade-ios`

Legend: ✅ shipped · 🟡 partial · ❌ missing · 🚫 N/A (web-only by design, or replaced by native UX)

**Last full audit:** 2026-05-13 (by Explore agent, see `PARITY_SPRINT_LOG.md`).
**Phase 1 (shared-core extraction):** ✅ Complete — `@lionade/core` consumed by both apps.
**Phase 2 (feature ports):** 🟡 In progress — 16 iOS surfaces on shared-core + 2 NEW iOS feature areas shipped (Duel, Learn hub + Paths) (2026-05-13):
1. **Daily Spin** (`Shop/DailySpinHero`) → `spinAPI` + `SPIN_SLOTS`
2. **Quiz** (`app/quiz.tsx`) → `quizAPI.saveResults`
3. **Daily Drill** (`use-daily-drill` hook) → `dailyDrillAPI`
4. **Clock-In / Login Bonus** (`use-clock-in` hook) → `loginBonusAPI`
5. **Streak Revive** (`use-streak-revive` hook) → `streakReviveAPI`
6. **Missions** (`use-missions` hook) → `missionsAPI`
7. **Bounties** (`use-bounties` hook) → `bountiesAPI`
8. **Classes** (`use-classes` hook) → `classesAPI.list`
9. **Friends/Social** (`use-friends` hook) → `socialAPI`
10. **Mastery session** (`use-mastery-session` hook) → `masteryAPI` (startSession, getSession, advance, submitAnswer)
11. **Daily Bet** (`use-daily-bet` hook) → `betsAPI.place`
12. **Recent Notes** (`use-recent-notes` hook) → `classesAPI.recentNotes`
13. **New Class form** (`NewClassModal` component) → `classesAPI.create`
14. **Quick Note FAB** (`QuickNoteFab` component) → `classesAPI.quickNote`
15. **New Mastery Exam form** (`NewMasteryExamModal` component) → `masteryAPI.parseExam` (also fixed pre-existing field-name bug)
16. **Daily Drill modal** (`DailyDrillModal` component) → `dailyDrillAPI.submit`

---

## Status Summary (2026-05-13, post-audit)

| Bucket | Web | iOS | Drift |
|---|---|---|---|
| Auth & Onboarding | ✅ | ✅ | none |
| Home / Dashboard | ✅ | ✅ | none (iOS merges dashboard into home — by design) |
| Learning (Ninny, Paths, Mastery) | ✅ | 🟡 | iOS missing /learn hub + /paths; Mastery orchestrator partial |
| Practice (Quiz, Arena) | ✅ | 🟡 | iOS arena UI exists, PvP matchmaking stubbed |
| Competitive (Duel, Compete, Leaderboard) | ✅ | 🟡 | iOS missing Duel |
| Classes | ✅ | 🟡 | iOS missing classes index + syllabus upload + grade tracker |
| Academia | ✅ | ✅ | none |
| Social | ✅ | 🟡 | iOS missing friend DM |
| Identity (Profile, Badges, Study-DNA) | ✅ | 🟡 | iOS missing Study-DNA |
| Economy (Shop, Wallet, Daily Spin) | ✅ | 🟡 | iOS shop cosmetics/boosters stubbed |
| Settings | ✅ | ✅ | none (iOS subscription routes to StoreKit) |
| Gamification (Games) | ✅ | ❌ | iOS missing |
| System / Legal | ✅ | 🚫 | iOS uses native modals (by design) |

---

## Feature-Level Parity Table (post-audit, corrected)

| Feature | Web route(s) | iOS route(s) | Web | iOS | Notes |
|---|---|---|---|---|---|
| **Auth & Onboarding** | | | | | |
| Login | `/login` | `/login` | ✅ | ✅ | email + Google + Apple auth on both. **Web Apple sign-in added 2026-05-24** (was iOS-only; web now at OAuth-provider parity. `handleAppleAuth` mirrors `handleGoogleAuth`; uses `supabase.auth.signInWithOAuth({ provider: 'apple' })`, redirect-back to current origin. Black button below Google on both Log In and Sign Up tabs.) |
| Sign up | `/login` (signup tab) | `/signup` | ✅ | ✅ | **NEW iOS feature 2026-05-21** — email/password + Apple/Google via shared `lib/auth-oauth.ts`; email-confirm "check your email" state; reached from login "New user" tile. RouteGuard allows `/signup` pre-auth. |
| Onboarding | `/onboarding` | `/onboarding` | ✅ | ✅ | **Expanded to web parity 2026-05-21** — 7 web-style grouped steps: username pick (live availability) · "About you" (first name + DOB 13+ gate + education) · "Goals" (study-goal + referral) · subjects · daily-goal · level · diagnostic. Mascot = **Ninny**; DOB auto-advances cells + shows a reactive age line. Writes verified vs live schema (`daily_target_minutes`; name/DOB/referral → auth metadata). Classes step **removed** (moved to Academia onboarding). Gate keys off `onboarding_completed` only — fixes OAuth users skipping onboarding via auto-username. |
| Academia onboarding | `/academia/onboarding` | `/academia-onboarding` | ✅ | ✅ | **NEW dedicated iOS screen 2026-05-22** — 5-step funnel mirroring web (school type · class count · school+grade · field · intensity); gates the Study tab via `useFocusEffect` → `/api/academia/onboarding`; same POST payload. Was previously folded into signup onboarding. |
| **Home & Dashboard** | | | | | |
| Landing page | `/` | (n/a) | ✅ | 🚫 | iOS opens to tabs by design. **Went fully public 2026-05-24** — removed `ComingSoonPage` framing: "Coming Soon — 2026" navbar badge replaced with `Sign In` link; hero + big-CTA waitlist forms replaced with "START STUDYING FREE" → `/login` buttons; waitlist demoted to small footer `Get product updates` form; ROADMAP "Q1 2026 Private Beta" collapsed into "Live Now V1"; FAQ #9 rewritten ("Is Lionade live yet?" — Yes). Beta-gate password modal (5-click secret trigger + `/api/beta-gate` route + `BETA_GATE_PASSWORD` env) **deleted entirely**. Orphan `app/home/page.tsx` (223 lines, "ProductLandingPage" — only reachable via the deleted DevOps modal, gated on a now-unsettable localStorage key) **also deleted**. Web-only change — iOS never had a coming-soon gate (the App Store IS the iOS launch gate). |
| Home tab | `/home` | `(tabs)/index` | ✅ | ✅ | full dashboard: drill, missions, bounties, weekly chart, stat orbs |
| Dashboard (separate) | `/dashboard` | (merged into home) | ✅ | 🚫 | KILL on web — merge into /home |
| **Learning** | | | | | |
| Learn hub | `/learn` | `app/learn/index.tsx` | ✅ | ✅ | **NEW iOS feature shipped 2026-05-13** — hub with 3 CTAs (Mastery, Quizzes, Paths), subject mastery snapshot, missions widget, recent activity, 7-day heatmap |
| Learn → Ninny | `/learn/ninny` | (redirects to `/mastery`) | ✅ | 🚫 | **By design** — iOS Mastery mode IS the chat-first Ninny tutor. Hub points the "AI tutor" CTA at `/mastery`. |
| Learn → Paths | `/learn/paths` + `/[subject]` | `app/learn/paths.tsx` + `app/learn/paths/[subject].tsx` | ✅ | ✅ | **NEW iOS feature shipped 2026-05-13** — 4 subject grid + stage-detail with map/lesson/quiz/results flow. Gracefully handles 0-row tables ("Coming soon" overlay). |
| Learn → Mastery | `/learn/mastery` + `/[examId]` | `/mastery` + `/mastery/[examId]` | ✅ | ✅ | **Orchestrator integration completed 2026-05-14** — all 3 pending states wired (question + teach + socratic). New: Continue button for teach mode, multiline text-input + Send for socratic mode. `masteryAPI.submitSocratic` added to core. |
| **Practice** | | | | | |
| Quiz hub | `/quiz` | `/quiz` | ✅ | ✅ | full flow on iOS — **wired to `@lionade/core/api/quiz.quizAPI.saveResults`** (2nd shared-core consumer) |
| AP Exams quiz | `/quiz/ap-exams` | (n/a) | ✅ | 🚫 | FOLD into `/quiz` as filter on both platforms |
| Arena | `/arena` | `/arena` | ✅ | ✅ | **NEW iOS shipped 2026-05-14** — full 4-phase flow wired (lobby → queue → prematch → playing → results). 2535 lines. Real-time-ish via HTTP polling (1s cap 30s). Server-judged timer, wager picker (10/25/50/100), opponent abandon handling, race-safe complete claim, idempotent retry. Challenge-a-friend typed in `arenaAPI` but UI deferred (social-screen wiring pending). |
| **Competitive** | | | | | |
| Duel | `/duel` | `app/duel.tsx` | ✅ | ✅ | **NEW iOS feature shipped 2026-05-13** — 5-phase flow (invite → loading → countdown → battle → results), simulated bot opponents, Supabase-direct duels persistence + winner Fangs payout |
| Compete tab | `/compete` | `(tabs)/compete` | ✅ | ✅ | ELO hero, 4 game modes, top 3 leaderboard |
| Leaderboard | `/leaderboard` | `/leaderboard` | ✅ | ✅ | top 50 with podium |
| **Classes** | | | | | |
| Classes index | `/classes` | (none) | ✅ | ❌ | port pending — iOS detail exists, no list |
| Class detail | `/classes/[id]` | `/classes/[id]` | ✅ | 🟡 | iOS has countdown + notes; missing syllabus upload, flashcards, grade tracker |
| Syllabus upload | `components/Class/SyllabusUpload.tsx` | `components/Class/SyllabusUploadSheet.tsx` | ✅ | ✅ | **NEW iOS feature shipped 2026-05-13** — 1671 lines. 5-stage sheet (source→preview→upload→parse→result). 3 on-ramps: camera, photo library, PDF picker. Photos auto-rendered to single-page PDF via expo-print on-device (matches server's PDF-only requirement). Upload via Supabase Storage direct + `classesAPI.uploadSyllabus()` JSON register call (no FormData added to createApiClient). Integrated as banner in `app/classes/[id].tsx`. |
| Exam countdown | `components/Class/ExamCountdown.tsx` | inline in academia tab | ✅ | 🟡 | iOS has inline countdown; standalone component port pending |
| Grade tracker | `components/Class/GradeTracker.tsx` | `components/Class/GradeTracker.tsx` | ✅ | ✅ | **NEW iOS shipped 2026-05-13** — 1867 lines. Tap-to-expand collapsed shell on class detail. Hero + list + add/edit modal. Semantic letter colors (A=green, B=electric, C=yellow, D/F=red — NOT gold per manifesto). 4 typed core methods (listGrades, createGrade, updateGrade, deleteGrade). |
| Flashcard study | `components/Class/FlashcardStudy.tsx` | `components/Class/FlashcardStudy.tsx` | ✅ | ✅ | **NEW iOS shipped 2026-05-13** — 1073 lines. Full-screen study modal with spring-physics flip animation, semantic confidence colors (Again=red/Hard=amber/Good=green/Easy=electric — no gold), Light/Medium haptics per rating. 2 typed core methods (listFlashcards, rateFlashcard). |
| **Academia** | | | | | |
| Academia hub | `/academia` | `(tabs)/academia` | ✅ | ✅ | classes grid, countdown, notes, empty state |
| **Social** | | | | | |
| Social tab | `/social` | `(tabs)/social` | ✅ | 🟡 | friends list works; friend DM not implemented |
| **Identity** | | | | | |
| Profile | `/profile` | `(tabs)/profile` | ✅ | ✅ | hero portrait, 4 stat tiles, 3 segments |
| Badges | `/badges` | `/badges` | ✅ | ✅ | full gallery with rarity rings |
| Study DNA | `/study-dna` | `app/study-dna.tsx` | ✅ | ✅ | **NEW iOS feature shipped 2026-05-13** — 1059 lines, uses canonical `/api/study-dna` endpoint, identity card, strengths/weaknesses, heatmap, native iOS share sheet (no canvas hack), triple empty-states |
| **Economy** | | | | | |
| Shop | `/shop` | `/shop` | ✅ | 🟡 | iOS has Daily Spin hero; cosmetics + boosters stubbed "Coming soon" |
| Daily Spin | `app/api/spin/roll` + UI | `Shop/DailySpinHero` + `SpinResultModal` + `SpinWheel` | ✅ | ✅ | **Shared-core wired** — first canary feature, uses `spinAPI` + `SPIN_SLOTS` from `@lionade/core` |
| Wallet | `/wallet` | `/wallet` | ✅ | ✅ | balance + lifetime + transaction history |
| **Settings** | | | | | |
| Settings | `/settings` | `/settings` | ✅ | ✅ | **Apple HIG rebuild + Account/Security/Permissions sections 2026-05-14**. Profile card → `/edit-profile`. New Account section: Edit profile · Security · Permissions. Appearance now includes App icon picker (Pro/Platinum perk). Plus existing: Subscription, Appearance, Notifications, Privacy, Support, About, Sign out, Delete account. Primitives extracted to `components/SettingsPrimitives.tsx`. |
| App Icon picker | (web-only N/A) | `app/app-icon.tsx` | 🚫 | ✅ | **NEW iOS shipped 2026-05-14** — Pro/Platinum tier perk. 5 variants (Default/Midnight/Wildfire/Platinum/Void). AsyncStorage persistence, Pro-lock upgrade Alert routing to /pricing. Native switch stubbed (applies on next EAS rebuild with `react-native-change-icon`). |
| Security | (web-only, distributed) | `app/security.tsx` | 🟡 | ✅ | **NEW iOS shipped 2026-05-14** — 941 lines. Sign-in method detection (Email/Apple via app_metadata.provider). Change Password modal (current/new/confirm + strength meter + show/hide). Biometric lock (Face ID/Touch ID via expo-local-authentication, only renders if hardware+enrolled). Active sessions: this device + Sign out everywhere (supabase.auth.signOut({ scope: 'global' })). 2FA stub. Data export → POST /api/account/export with 404-graceful fallback. |
| Edit Profile | `/profile` (mixed) | `app/edit-profile.tsx` | 🟡 | ✅ | **NEW iOS shipped 2026-05-14** — 1202 lines. Avatar picker (library upload via expo-image-picker → Supabase Storage avatars/${userId}.jpg, regenerate DiceBear, remove). Username with 365-day cooldown via `profileAPI.changeUsername`. Display name (1-50). Bio (0-150, graceful degrade if bio column missing). Debounced availability check. Sticky save bar. Dirty-state confirm-discard. |
| Permissions | (web-only, system) | `app/permissions.tsx` | 🚫 | ✅ | **NEW iOS shipped 2026-05-14** — 365 lines. Status chips (Allowed/Limited/Denied/Ask) for Notifications · Camera · Photo Library. Re-checks on every screen focus. In-app prompt for Notifications when undetermined. Open iOS Settings deep-link. Footnote: lists what we DON'T ask for (location/contacts/microphone). |
| Subscription | `/settings/subscription` | (StoreKit deep-link) | ✅ | 🚫 | iOS uses Apple manage-subscription URL |
| Pricing | `/pricing` | `/pricing` | ✅ | ✅ | full plans on iOS, monthly/annual toggle. **Web redesigned 2026-05-15** — glassy cards + page-local Lionade WebGL shader (`components/PricingShader.tsx`, raw WebGL, reduced-motion static fallback, /pricing-scoped); plan/toggle/CTA logic unchanged. **iOS redesign SHIPPED 2026-05-15** (was the tracked pending follow-up — now done, cross-platform parity achieved): `app/pricing.tsx` reskinned (gradient-ring glass cards via expo-blur, centered "Most popular" gold badge, superscript `$` on extralight Bebas numerals, web-parity header/sub/eyebrow copy + "Save ~17%" toggle badge) + NEW `components/PricingShader.tsx` — a Skia (`@shopify/react-native-skia`) SkSL port of the web GLSL shader (navy `#04080F` → electric `#4A90D9` → sparse gold `#FFD700`, band*0.55/gleam*0.15 caps verbatim, NO hue-cycling; light-theme branch dropped — iOS is dark-only). Reduced-motion: `useReducedMotion` + live `AccessibilityInfo` listener → static Lionade gradient fallback + `useFrameCallback` clock fully inactive (battery parity w/ web's "rAF never initialised"). Page-local: mounted inside `app/pricing.tsx` only (absoluteFill, below content, above the global SpaceBackground that shows through the transparent Stack) — visually replaces the interstellar ON THIS SCREEN ONLY; `app/_layout.tsx`/`SpaceBackground.tsx`/other screens UNTOUCHED. **Business logic byte-identical** (SHA-256-verified): `PRICING`/`PLANS`/`FAQ`/`SUPPORT_EMAIL`/`upgrade()` mailto/`onUpgrade` wiring unchanged — NO StoreKit/IAP, founder-mailto CTA preserved (web CTAs NOT ported). |
| **Gamification** | | | | | |
| Games hub | `/games` | `app/games.tsx` | ✅ | ✅ | **NEW iOS feature shipped 2026-05-13** — 2081 lines, 4 games: Blitz (routes to /quiz), Roardle (fully ported wordle), Flash Cards (fully ported), Timeline Drop (tap-to-swap instead of HTML5 drag). PDF library upload dropped (RN-incompatible). Single electric hero, rest in neutral grouped list per manifesto. |
| **AI / Ninny modes** | | | | | |
| Chat panel | `components/Ninny/ChatPanel.tsx` | partial via mastery session | ✅ | 🟡 | audit in Week 2 |
| Multiple choice | `Ninny/MultipleChoiceMode.tsx` | partial | ✅ | 🟡 | audit |
| Flashcards | `Ninny/FlashcardsMode.tsx` | partial | ✅ | 🟡 | audit |
| Match | `Ninny/MatchMode.tsx` | partial | ✅ | 🟡 | audit |
| Fill blank | `Ninny/FillBlankMode.tsx` | partial | ✅ | 🟡 | audit |
| True/False | `Ninny/TrueFalseMode.tsx` | partial | ✅ | 🟡 | audit |
| Ordering | `Ninny/OrderingMode.tsx` | partial | ✅ | 🟡 | audit |
| Blitz | `Ninny/BlitzMode.tsx` | partial | ✅ | 🟡 | audit |
| **Cross-cutting widgets** | | | | | |
| Focus Lock-In | `components/FocusLockIn.tsx` | `components/FocusLockIn.tsx` | ✅ | ✅ | BUILT on iOS |
| Focus music toggle | `components/FocusMusicToggle.tsx` | (none) | ✅ | ❌ | port pending (Batch D) |
| Clock-in button | `components/ClockInButton.tsx` | `components/ClockInButton.tsx` + `ClockInToast.tsx` (hook on `loginBonusAPI`) | ✅ | ✅ | **shared-core wired** via `use-clock-in` |
| Daily Drill widget | `components/DailyDrillWidget.tsx` | `DailyDrillCard.tsx` + `DailyDrillModal.tsx` (hook on `dailyDrillAPI`) | ✅ | ✅ | **shared-core wired** via `use-daily-drill` |
| Duel invite | `components/DuelInvite.tsx` | inline in `app/duel.tsx` InvitePhase | ✅ | ✅ | folded into the single Duel route file |
| Quick note shortcut | `components/QuickNoteShortcut.tsx` | `components/QuickNoteFab.tsx` | ✅ | ✅ | BUILT on iOS |
| Notifications | (component-only) | `/notifications` (full route) | 🟡 | ✅ | web should match iOS, not other way |
| Daily bet | (web?) | `DailyBetCard.tsx` | ? | ✅ | verify web has parity |
| Missions | (web?) | `MissionsCard.tsx` | ? | ✅ | verify web has parity |
| Bounties | (web?) | `BountiesCard.tsx` | ? | ✅ | verify web has parity |
| Streak revive | server: `/api/streak-revive` | `StreakReviveBanner.tsx` + `use-streak-revive` (on `streakReviveAPI`) | ✅ | ✅ | **shared-core wired** via `use-streak-revive` |
| Claim/upgrade banner + Pro nudge | `components/ClaimBanner.tsx` (shell) + `ProUpgradeNudge.tsx`; applied to DailyReady/StreakRevive/ClockIn/DailyDrill | (none — iOS has native DailyReady/StreakRevive/ClockIn/DailyDrill equivalents but no shared `ClaimBanner` shell or Free→Pro nudge) | ✅ | ❌ pending | **NEW 2026-05-17** — web introduced one reusable `ClaimBanner` + a free-tier `ProUpgradeNudge` (`usePlan` → /pricing). iOS port: extract an equivalent shared banner in `@lionade/core`/native and add a Pro nudge on the iOS dashboard. Underlying claim APIs already shared (loginBonus/streakRevive/dailyDrill) — this is a presentational-shell + one new nudge port only. |
| Back affordance | `components/BackButton.tsx` (route-based) on all pushed pages | `components/BackButton.tsx` (route-based) on all 21 pushed screens | ✅ | ✅ | **NEW cross-platform shipped 2026-05-15** — single shared component per repo; semantic-parent map (NOT history); renders null on roots/tabs/funnels. iOS replaced ~21 ad-hoc disc/chevron controls (3 local `BackButton` copies + `BackChip` deleted). Native swipe-back kept. `edit-profile` discard-guard + arena/duel/quiz in-match abandon controls preserved (restyled, not replaced). |
| Limelight bottom-nav highlight | `components/Navbar.tsx` (framer-motion `layoutId="navLimelight"` shared-layout backdrop + `"navLimelightBeam"` top beam, conditionally rendered inside the active `<Link>`) | `app/(tabs)/_layout.tsx` (one `Animated.View` driven by `useSharedValue` + `withSpring` translateX against `state.index * cellW`, cellW from `onLayout`) | ✅ | ✅ | **NEW cross-platform shipped 2026-05-19** — single travelling gold pill springs to the active tab instead of per-cell static gold backdrop. Both platforms reuse existing `ACCENT_BG` / `ACCENT_BORDER` rgba(255,215,0,…) tokens — zero design-token drift. Reduced-motion: framer's `useReducedMotion()` → `{duration:0}` on web, Reanimated's `useReducedMotion()` → `withTiming(target,{duration:0})` on iOS. Web is hydration-safe: active state is pathname-driven so DOM tree is invariant SSR === first client render. iOS preserves haptics + `tabPress`/`defaultPrevented` guard + `accessibilityRole/State/Label`. |
| **System / Legal** | | | | | |
| About | `/about` | (none) | ✅ | 🚫 | iOS uses Settings → About modal |
| Contact | `/contact` | (none) | ✅ | 🚫 | iOS uses native mail |
| Privacy | `/privacy` | (none) | ✅ | 🚫 | iOS uses native modal |
| Terms | `/terms` | (none) | ✅ | 🚫 | iOS uses native modal |
| Demo | `/demo` | `/demo` | ✅ | ✅ | both apps have demo |

---

## Real Feature Gaps (Things iOS Genuinely Doesn't Have)

After the audit, the actual list of iOS-missing features is:

**High value (Batch A — Week 2):**
1. Duel (`/duel`) — entire feature missing
2. Learn hub (`/learn`) + Learn → Ninny + Learn → Paths
3. Classes index page
4. Arena PvP matchmaking ("Find Match" → real matches)
5. Mastery orchestrator full integration

**Medium value (Batch B — Week 3):**
6. Syllabus upload
7. Grade tracker
8. Flashcard study (standalone)
9. Study DNA
10. Shop cosmetics + boosters (UI exists, stubbed)
11. Friend DM

**Low value (Batch D — Week 4 or defer):**
12. Games hub
13. Focus music toggle

---

## Reverse Parity — Things iOS has that Web Should Match

These are flagged for the WEB team — iOS shipped them first or better:
- **Notifications inbox** — iOS has full `/notifications` route; web has component only
- **Daily Bet** — verify web has it
- **Bounties card** — verify web has it
- **Streak Revive UI** — iOS has dedicated banner + hook
- **Native auth flow polish** — Apple auth, haptics, animated intro on iOS

---

## Deliberate No-Row Decisions (perf/architecture refactors)

These web changes intentionally have **no parity row** — recorded here so a future audit doesn't misread the absence as missed tracking:

- **2026-05-25 — Cache + SWR Phase A — tab-switch refetch fix (both platforms staged, awaiting user greenlight to push/build).** Web ran a surgical 5-change pass on top of the 2026-05-17 SWR navigation refactor: (1) global SWR defaults `revalidateOnFocus: true → false` + `dedupingInterval: 5s → 60s` (`lib/swr-config.ts`); ~24 explicit per-hook `revalidateOnFocus: true` overrides preserved on the freshness-sensitive surfaces (Navbar notifications, `useUserStats` Fangs balance, Social unread badges, ClockIn, StreakRevive, DailySpin, etc.). (2) Shop inventory raw `useEffect → useSWR("shop-inventory/" + uid, ...)` + `mutateInventory()` from purchase/equip (`app/shop/page.tsx`). (3) Compete leaderboard raw `useEffect → useEloLeaderboard(5)` (`app/compete/page.tsx`, uses existing `lib/hooks.ts` hook). (4) `/api/notifications` poll deduped — Navbar + Social both now keyed on `notifications/${user.id}`, single 15s poll + single realtime channel invalidates the shared key (`components/Navbar.tsx`, `app/social/page.tsx`). (5) Dashboard `POST /api/bounties/rotate` gated by `localStorage["bounties-last-rotation"]` 1h timestamp instead of firing per-mount (`app/dashboard/page.tsx`). This is a **perf / data-fetch-cadence** change with **zero user-facing feature surface** — same precedent as the 2026-05-17 entry below. **iOS team is running an equivalent Phase A in parallel** (different libraries, same goal: kill tab-switch revalidation storms); the 2026-05-13 audit already assessed the iOS data layer as exemplary on the raw-fetch dimension. Both platforms staged — web has a local commit (NOT pushed); iOS code ready (NOT yet built into a TestFlight). Awaiting Sam's review + greenlight before push/build. Chain: `admin` (web orchestrator) → in-place implementation (5 files) → type-check pass → `quality-qa-tester` (5 happy-path + edge cases) → `quality-code-reviewer` clean → `quality-docs-writer` (CHANGELOG + vault Daily/2026-05-25.md + this row).

- **2026-05-17 — Web SWR navigation refactor.** ~8 pages migrated from raw `useState`+`useEffect`+`lib/db.ts` fetches to the existing global persistent `<SWRConfig>` cache (+ 4 `<a>`→`<Link>` swaps, 2 P3 micro-opts). This is a **data-fetch-mechanism / performance** change with **zero user-facing feature surface** — no new screen, flow, copy, or capability. There is nothing for a user to "see" on iOS, so no feature to port. Separately, the iOS data layer was audited 2026-05-13 (Phase 1 `@lionade/core` hooks: `quizAPI`, `socialAPI`, `missionsAPI`, etc., all already SWR/cache-backed) and assessed as **already exemplary** — it does not have the raw-fetch anti-pattern this web pass fixed. Adding a parity row would therefore be spurious. (`quality-docs-writer`, per `admin` routing.)

- **2026-05-22 — iOS build 9: native UX pass (no web port).** Five iOS-only interaction enhancements shipped to TestFlight (build 9): (1) **edge-swipe-back fixed** via `fullScreenGestureEnabled` on the nav Stack (works full-width, not just the ~20px edge); (2) **blurred-backdrop bottom sheets** — shared `Sheet` now blurs the app behind it (expo-blur) + hairline-bordered floating card; Quick Note capped below full-screen; (3) **gold oval "+ ADD"** on the Academia/Study header (was faint); (4) **tappable dashboard stat orbs** → blurred per-stat detail windows (Fangs/Streak/Level/Subjects/Rank); (5) **profile side panel** — avatar tap opens a left slide-in drawer (Edit Profile / Settings / Notifications / Sign out). These are iOS-native interaction polish on existing surfaces, or iOS-only-by-design (swipe-back, slide-in drawer) — **no web feature to port**, tracked here for completeness. Chain: `design-ui-ux` intent → `dev-frontend` ×3 → `quality-code-reviewer` (clean, 0 critical/high) → `quality-docs-writer`. ⚠️ On-device watch-item: `fullScreenGestureEnabled` vs horizontal-swipe screens (flashcards / drag-based Ninny games) — disable per-screen if it races the back-swipe.

- **2026-05-22 — iOS build 10: profile hub redesign + cross-platform avatar sync (no web port).** Two iOS changes shipped to TestFlight (build 10): (1) the **profile side panel** was rebuilt into a richer hub — a neon-ringed (tier-colored, breathing) avatar + tier & Fangs chips, a gradient **Go Pro** card (dormant PRO-member branch ready for when subscriptions are wired), a **2×3 shortcuts grid** (Shop / Wallet / Badges / Leaderboard / Games / Study DNA), Account rows (Edit Profile / Settings / Notifications), and a **More** section (Invite a Friend share sheet / Rate Lionade / Help & Support / Privacy & Terms) — all routes verified. Also fixed build-9's invisible panel row labels (rows now use the proven `NavRow` pattern, not the unrendered `fontFamily:"Inter-Medium"`). (2) **Cross-platform avatar sync** — the web stores avatars as DiceBear SVG URLs that React Native can't render (iOS was falling back to initials); iOS now resolves them to PNG (`/svg`→`/png`) and uses the same DiceBear default, so the **same profile picture renders on web + iOS** (shared `profiles.avatar_url`; uploaded Storage photos pass through unchanged). iOS-only polish/parity — no web feature to port. Chain: web research (general-purpose) → `dev-frontend` ×2 → `quality-code-reviewer` (shippable, 0 critical/high) → `quality-docs-writer`.

- **2026-05-23 — iOS build 11: profile hub inline + panel polish + onboarding-sync fix + audit fixes (no web port).** Shipping to TestFlight today (build 11): (1) **Profile tab → full settings hub** — the "You" tab is now one long Apple-HIG scrollable page mirroring web's profile+settings depth (Hero + stats + Lifetime + Recent Badges + Stats&Rankings + Account + Subscription + Appearance + Notifications + Privacy + Recent Activity + Support + About + Sign out / Delete account); shares the same Supabase `user_preferences` row + AsyncStorage key as `/settings` so toggles round-trip. (2) **Profile side panel polish** — Go-Pro card is now a fully-rounded **pill with a 7s seamless marquee gradient** (gold→purple→electric flowing left, palette repeats so the loop is invisible; respects reduce-motion); Account + More replaced with **5 shortcut tiles in a centered 2-2-1 grid** (Edit Profile · Settings / Notifications · Invite a Friend / Rate Lionade); Help & Support + Privacy & Terms moved to small dim text links above Sign out; **panel right edge is now curved/oval** via a two-layer surface (outer owns slide + shadow, inner owns `borderTopRightRadius/borderBottomRightRadius: 48` + `overflow: hidden`) since iOS shadows don't compose with masked layers. (3) **Cross-platform onboarding-sync fix** — iOS auth gate (`lib/auth-context.tsx`) now treats a profile as onboarded if `selected_subjects` or `education_level` is set (onboarding-only data, OAuth can't auto-derive), and **self-heals** by backfilling `onboarding_completed=true`; web-onboarded accounts no longer get re-prompted on iOS while Apple/Google fresh signups still flow through onboarding. (4) **Daily Fangs toast** auto-dismiss 5s → **3s** (`components/ClockInToast.tsx`). (5) **Audit fixes**: support email standardized to `support@getlionade.com` everywhere (profile + settings were on the wrong `lionade.com` domain — bouncing mail); app-icon variants Midnight / Wildfire / Platinum / Void now show **"SOON" tags + lock overlays + a "Coming Soon" alert on tap** (their preview PNGs are still the default icon; real artwork + native swap land in a future build). Chain: web research (general-purpose) → `dev-frontend` ×4 → `quality-qa-tester` (audit: 11/13 routes populated, 2 must-fixes resolved) → `quality-code-reviewer` → `quality-docs-writer`.

- **2026-05-23 — iOS build 12: bottom tab bar web-parity + panel polish v2 (no web port).** Shipping to TestFlight (build 12): (1) **Bottom tab bar restructured to match web nav** — 5 tabs in web-parity order: **Home · Academia · Learn · Compete · Social**. "Study" renamed to "Academia"; **Learn promoted to a top-level tab** (39KB hub moved from `app/learn/index.tsx` → `app/(tabs)/learn.tsx`, BackButton stripped); **"You" dropped from the bar** (file stays routable via `<Tabs.Screen name="profile" options={{ href: null }} />`); the rich `/profile` hub is now reached by **tapping the avatar in the side-panel header** (Edit Profile tile remains a distinct quick-edit shortcut). (2) **Active tab pill — tighter edge corners** — limelight height 58 → 64; on edge cells (Home / Social) it receives a translateX ±3 nudge + a width +6 grow so the pill kisses the bar's rounded inner curve instead of floating mid-corner. (3) **Profile side panel polish v2** — Options grid rebuilt as **5 circle-icon tiles** (icon on top, centered label below, no outer card, fixed 84pt width so 2-2-1 lines up under the row-1/row-2 seam: Edit Profile · Settings / Notifications · Invite a Friend / Rate Lionade); **Sign out → centered red-outlined pill button**; Help & Support + Privacy & Terms moved to the **very bottom** under a hairline divider, above the build footer; **Go-Pro pill "shape moving" bug fixed** — the inner gradient layer had its own `borderRadius: 999`, so its rounded left edge was sliding through the pill window during the marquee translate (read as the silhouette moving); removed the inner radius, the pill outer now enforces the shape via `overflow: hidden` + outer `borderRadius: 999`, only the colors flow. iOS-only structural polish — no web feature to port. Chain: `dev-frontend` ×2 → `quality-code-reviewer` → `quality-docs-writer`.

- **2026-05-23 — iOS build 13: panel polish v3 + Learn/Compete web-parity + leaderboard top-20-anchored.** Shipping to TestFlight (build 13). Six bundled iOS-only changes: (1) **Panel polish v3** — Go-Pro pill marquee is *truly seamless* now (7-stop palette anchored on GOLD at positions 0/0.5/1.0 → byte-identical loop boundary, no visible refresh); Go-Pro + PRO MEMBER restructured into the canonical iOS two-layer (outer paints shadow + scale, inner clips with `overflow:hidden + borderRadius:999`) — fixes the "colors going outside" bleed; pill now `maxWidth: 300` centered with reduced shadow opacities. (2) **Bottom tab pill** — `top: 3` on the active limelight so it sits vertically centered in the 70pt bar (was riding 6pt above the cell content); orphan `edgeOffset` shared value cleaned up. (3) **Learn tab web-parity polish** — CTA deep-links to weakest subject (`/quiz?subject={weakestSubject}`), mastery rows route per-subject, **heatmap legend** added (less → 5 gold swatches → more), today's heatmap cell gained a gold glow, the Level stat chip now surfaces the lowercase tier name (e.g. "rookie") under the number, and the RECENT section header gained a tappable `new →` link to start a fresh quiz. (4) **Compete row layout fix** — `<BlurView>` wrapper in `GroupedList` was collapsing intrinsic widths on iOS, making `ModeRow` chevrons appear to wrap below; swapped for a plain matte `View` fill. `ModeRow` labels switched to the safe `Inter` font (not the registered-but-broken `Inter-Medium` that bit us in build 9); chevron remains the LAST sibling after the `flex:1` label View; `minHeight: 56` for uniform touch targets. (5) **Daily Bet → back to Dashboard** (web parity — web Compete doesn't carry Daily Bet); the card now sits inside the Today section between Bounties and Progress, restoring its pre-2026-05-13 home. (6) **Compete leaderboard surface** — removed the embedded Top Players mini-leaderboard; replaced with a single "Leaderboard" row at the bottom of the Modes group → routes to `/leaderboard`. The leaderboard screen now renders the **top 20** (podium 1–3 + list 4–20); if the user is outside top 20 their rank anchors at the bottom in a gold-tinted highlight (covers ranks 21–60 from fetched entries, falls back to absolute rank + profile stats if outside top 60). `useLeaderboard` hook: `TOP_N` 50 → 60, exposes `userRank: number | null`. iOS-only — no web feature to port. Chain: `general-purpose` web research → `dev-frontend` ×4 → `quality-code-reviewer` → `quality-docs-writer`.

---

## How to Use This File

**When shipping a NEW feature:**
1. Add a row in the relevant section with `Web: ✅` and `iOS: ❌ port pending`.
2. Mention in CHANGELOG that iOS parity is tracked here.

**When porting to iOS:**
1. Flip the iOS column from `❌` to `✅` (or `🟡` if partial).
2. Note the iOS route path or component path.

**Audit cadence:** Quarterly full audit by `Explore` agent + `quality-docs-writer`.

---

*Strategy = shared-core extraction (Strategy C) starting Week 1. Once core lands, parity-by-default becomes the default workflow — no more drift.*
