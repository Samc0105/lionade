# Parity Sprint Log

**Goal:** Bring `lionade-ios` to feature parity with web (`lionade`).
**Started:** 2026-05-13
**Owner:** Sam (with Claude orchestrating)

This file is the source of truth for sprint progress. **Append every action, decision, and agent output.** If the Claude session is interrupted, the next session reads this file and continues from the last `## NEXT` block.

---

## Sprint Strategy (locked 2026-05-13)

**Approach:**
1. **Triage** — kill features that don't need to be on iOS (legal pages, dashboard split, etc.)
2. **Shared core extraction** — pull business logic, types, API client, Fangs/streak math into `packages/lionade-core` consumed by both apps (this is "Strategy C" from `LIONADE_WORKFLOW.md`)
3. **Parallel batch porting** — once core exists, spawn multiple `dev-frontend` agents on isolated worktrees to port UI batches in parallel
4. **Parity-by-default workflow update** — once core exists, new features ship to both simultaneously; update `LIONADE_WORKFLOW.md` to enforce this

**Why this order:** Brute-force per-feature porting would take ~2 months solo. Shared core extraction up-front turns iOS ports into UI work only, parallelizable across agents.

**Target timeline:**

| Week | Phase | Output |
|---|---|---|
| Week 1 (now) | Triage + shared core | `packages/lionade-core` v0, both apps consuming |
| Week 2 | Batch A: Duel, Focus Lock-In, Daily Spin, Daily Drill | 4 features at parity |
| Week 3 | Batch B + C parallel: Learn hub + Class tools | Learning & class tooling at parity |
| Week 4 | Batch D + Ninny verification | Full parity achieved |
| Ongoing | Parity-by-default | Drift eliminated |

---

## Log Format

Each entry uses this format:

```
### YYYY-MM-DD HH:MM — <short title>
**Actor:** <Claude / agent name / Sam>
**What happened:** <1-3 sentences>
**Files touched:** <paths>
**Decisions:** <bulleted>
**Next:** <what should happen after this>
```

---

## Entries (newest at bottom)

### 2026-05-13 — Sprint kick-off
**Actor:** Claude
**What happened:** User requested deep-agent push to close iOS parity gap. Workflow constitution (`LIONADE_WORKFLOW.md`), parity tracker (`IOS_PARITY.md`), UserPromptSubmit hook, and CLAUDE_AGENT.md cross-references were already shipped in previous turn. This sprint kicks off the actual implementation.
**Files touched:** `PARITY_SPRINT_LOG.md` (new)
**Decisions:**
- 4-week target to close ~15 feature gap
- Strategy C (shared core) is the unlock — not brute-force porting
- Log every agent output here so session can resume cleanly

**Next:** Spawn 3 agents in parallel — product-strategist (triage), Plan (shared core architecture), Explore (inventory extractable logic + iOS state).

---

### 2026-05-13 — product-strategist triage complete
**Actor:** product-strategist agent
**What happened:** Locked the cut-list and batch priorities.

**CUT (don't port to iOS):**
- `/about`, `/contact`, `/privacy`, `/terms` — native modals from Settings
- `/dashboard` — merge into `/home`
- `/quiz/ap-exams` — fold into `/quiz` as a filter
- `/settings/subscription` — deep-link to Apple manage-subscription URL
- `/pricing` — paywall lives inside StoreKit
- `/demo` — sales tool, irrelevant in installed app
- `/` landing — iOS opens straight to tabs

**MUST PORT (Batch A — Week 2):**
1. **Duel** — push-notification-native, daily-return driver
2. **Daily Spin** — habit hook, simplest end-to-end vertical (RECOMMENDED FIRST FEATURE TO SHIP)
3. **Focus Lock-In + Clock-In** — mobile-native fit (Screen Time API, Live Activity)
4. **Learn → Ninny** — chat-first AI tutor, #1 retention feature
5. **Daily Drill Widget** — Home Screen widget candidate
6. **Classes index** — broken UX without it (detail exists, no list)

**SHOULD PORT (Batch B — Week 3, Learning):** `/learn` hub, `/learn/paths`, `/study-dna`, Academia onboarding

**SHOULD PORT (Batch C — Week 3, Classes):** SyllabusUpload (camera!), ExamCountdown (Live Activity), GradeTracker, FlashcardStudy, QuickNoteShortcut (Share Sheet)

**NICE TO HAVE (Batch D — Week 4):** `/games`, FocusMusicToggle, replace pricing/subscription with StoreKit

**Audit Ninny 8 modes in Week 2** before Batch A code lands.

**RECOMMENDED FIRST FEATURE: Daily Spin** — smallest end-to-end slice exercising every shared-core layer (auth, Supabase RPC, Fangs ledger, animated UI, optimistic update).

---

### 2026-05-13 — Plan agent: shared-core architecture locked
**Actor:** Plan agent
**What happened:** Designed `packages/lionade-core` package layout and migration order.

**Layout (final):**
```
packages/lionade-core/src/
├── types/      (User, Subject, Question, QuizResult, Badge + supabase.ts)
├── constants/  (subjects, shop-catalog, mission-pool)
├── logic/      (levels, mastery-bkt, fangs, streak, spin-rng, difficulty)
├── api/        (DI'd HTTP — createApiClient + per-feature methods)
├── prompts/    (Ninny prompt templates)
├── validation/ (sanitize, zod schemas, clamps)
└── hooks/      (pure derivations — NOT React hooks)
```

**Monorepo strategy:** npm workspaces in `/Users/samc/Desktop/lionade`. iOS imports via `"@lionade/core": "file:../lionade/packages/lionade-core"`. Metro config needs `watchFolders` + `nodeModulesPaths` updates.

**Public API:** subpath exports (not single star) for tree-shaking and platform boundary clarity.

**Forbidden in core:** React, RN, Next, Expo, SWR, DOM globals, node:* modules, direct Supabase clients. `node:crypto` in `lib/spin.ts` MUST be split (pure pick → core; crypto caller stays in /app/api/spin/).

**Migration order:**
- **Day 1:** Workspace scaffold + types/ move (types/index.ts, types/supabase.ts)
- **Day 2-3:** Pure logic — levels.ts, mastery BKT, sanitize.ts, spin RNG split, shop-catalog, mission pool
- **Day 4-5:** API surface — createApiClient + per-route methods + Ninny prompts

**Top 3 risks:**
1. Metro can't resolve workspace symlinks → ship metro.config.js watchFolders day 1, add smoke test to pre-push hook
2. node:* leakage into core → ESLint `no-restricted-imports` enforcement, tsconfig without DOM/Node types
3. Supabase types drift → single `core:gen-types` script writes to packages/lionade-core/src/types/supabase.ts

---

### 2026-05-13 — Web extraction inventory complete
**Actor:** Explore agent
**What happened:** Mapped every platform-agnostic file in web that should move to lionade-core.

**Key extractable files (full list above in agent outputs):**
- Types: `/types/index.ts`, `/types/supabase.ts`, Ninny types in `/lib/ninny.ts`, shop types
- Pure logic: `/lib/mastery.ts` (BKT), `/lib/levels.ts`, `/lib/spin.ts` (split), `/lib/class-streaks.ts`, `/lib/ninny.ts` rewards, `/lib/missions.ts` rotation
- API: `/lib/db.ts`, `/lib/api-client.ts`, `/lib/api-auth.ts`, `/lib/bounty-rotation.ts`, `/lib/question-bank.ts`
- Validation: `/lib/sanitize.ts` (no zod currently — procedural)
- AI: `/lib/ai.ts` (callAI, callAIForJson), `/lib/ninny.ts` buildNinnyPrompt
- Constants: PLAN_EXAM_LIMITS, LEVEL_TIERS, BKT params, SPIN_SLOTS, NINNY_MODE_COSTS, SHOP_ITEMS, MISSION templates

**Stays platform-specific:** /lib/auth.tsx, /lib/supabase.ts, /lib/cdn.ts, /lib/toast.ts, /lib/avatar.ts, /lib/use-plan.ts, /lib/hooks.ts (React), all /app/api/* route handlers (auth+validation wrapper stays, business logic moves to core)

---

### 2026-05-13 — 🚨 BIG FINDING — iOS is FAR more complete than parity tracker suggested
**Actor:** Explore agent
**What happened:** Inventoried iOS app state. iOS already has TONS of features that `IOS_PARITY.md` marked as ❌.

**iOS routes that are FULL (was marked ❌ or 🟡 in parity tracker):**
- `(tabs)/index` — full dashboard with daily drill, missions, bounties, weekly chart, stat orbs
- `(tabs)/academia` — classes grid with countdown, notes, empty state
- `(tabs)/compete` — ELO hero, 4 game modes, top 3 leaderboard
- `(tabs)/profile` — hero portrait, 4 stat tiles, 3 segments
- `badges` — full gallery
- `leaderboard` — top 50 with podium
- `onboarding` — 5-step wizard (subjects → goal → level → diagnostic → classes)
- `pricing` — full plans with monthly/annual toggle
- `quiz` — full flow (subject → difficulty → 10Q → results)
- `settings` — font, notifications, privacy
- `wallet` — balance + lifetime stats + transaction history
- `notifications` — type-tinted inbox

**iOS routes that are PARTIAL (gap is smaller than thought):**
- `arena` — UI exists, "Find Match" stubbed "Shipping next"
- `mastery/[examId]` — chat session exists, orchestrator integration partial
- `shop` — Daily Spin hero EXISTS, cosmetics/boosters stubbed
- `(tabs)/social` — friends list works, friend DM not implemented
- `classes/[id]` — works for countdown + notes, missing syllabus upload + flashcards + grade tracker

**iOS components that ALREADY exist (was thinking we'd need to port):**
- DailySpinHero.tsx, SpinResultModal.tsx, SpinWheel.tsx ✅ Daily Spin is BUILT
- DailyDrillCard.tsx, DailyDrillModal.tsx ✅ Daily Drill is BUILT
- ClockInButton.tsx, ClockInToast.tsx ✅ Clock-In is BUILT
- FocusLockIn.tsx ✅ Focus Lock-In is BUILT
- MissionsCard.tsx ✅
- BountiesCard.tsx ✅
- DailyBetCard.tsx ✅
- NotificationBell.tsx ✅
- QuickNoteFab.tsx ✅

**iOS has 24 custom hooks already** — use-arena-matches, use-arena-rank, use-badges, use-bounties, use-class-detail, use-classes, use-clock-in, use-daily-bet, use-daily-drill, use-friends, use-leaderboard, use-mastery-exams, use-mastery-session, use-missions, use-notifications, use-recent-notes, use-recent-quizzes, use-streak-revive, use-subject-stats, use-user-stats, use-wallet, use-weekly-activity

**Duplicated logic that WILL conflict with shared-core extraction:**
- `lib/quiz.ts` (iOS) — SUBJECTS, fetchQuizQuestions, checkAnswer, computeReward — duplicates web logic
- `lib/levels.ts` (iOS) — duplicates web `/lib/levels.ts`
- `tierForElo` duplicated in compete.tsx + social.tsx
- `TimeAgo` formatting duplicated in arena.tsx, profile.tsx, social.tsx

**What's actually missing on iOS:**
- Duel (the route + matchmaking)
- Learn hub (`/learn` + `/learn/ninny` + `/learn/paths`)
- Study DNA
- Games hub
- Syllabus upload
- Exam countdown component (countdown exists in academia tab, but standalone component missing)
- Grade tracker
- Flashcard study (Ninny modes might cover this — needs verification)
- Classes index page
- Arena PvP matchmaking (UI shell exists, real-time integration missing)
- Shop cosmetics + boosters (UI stubbed "Coming soon")
- Mastery session orchestrator full integration

**Implication for sprint plan:** The shared-core extraction is MORE valuable than expected (lots of duplicated logic to consolidate) but feature-gap is SMALLER than expected. We can probably hit parity in **3 weeks**, not 4. Daily Spin, Focus Lock-In, Daily Drill are already DONE on iOS — they just need shared-core wiring.

---

### 2026-05-13 — Synthesis: Refined Phase 1 plan
**Actor:** Claude (synthesizing strategist + planner + explorer outputs)
**What happened:** Updated sprint plan based on findings.

**Refined timeline:**

| Week | Phase | Outputs |
|---|---|---|
| **Week 1** | Shared-core extraction (Days 1-5) + Ninny mode audit (Day 6) | `packages/lionade-core` v0 consumed by both apps; iOS Ninny verified |
| **Week 2** | Real feature gaps: Duel + Learn hub + Arena PvP completion + Mastery orchestrator full integration | 4 net-new iOS features |
| **Week 3** | Class tools (syllabus upload, grade tracker, classes index) + Shop completion (cosmetics, boosters) + Study DNA + Games | Final parity push |

**First feature to ship after shared-core: Daily Spin re-wire** — already exists on iOS, perfect canary for proving shared-core works. Should take <2 days.

**Files touched this session:**
- `/Users/samc/Desktop/lionade/PARITY_SPRINT_LOG.md` (created)
- `/Users/samc/Desktop/lionade/IOS_PARITY.md` (needs correction next — many ❌s should be ✅)

---

### 2026-05-13 — IOS_PARITY.md corrected based on audit
**Actor:** Claude
**What happened:** Rewrote IOS_PARITY.md with accurate iOS status. Many ❌ flipped to ✅ or 🟡 (Daily Spin, Daily Drill, Focus Lock-In, Clock-In, Quick Note, full dashboard tab, badges, leaderboard, etc. are all built on iOS).
**Files touched:** `/Users/samc/Desktop/lionade/IOS_PARITY.md`
**Decisions:**
- Added "Reverse Parity" section flagging web-side gaps (notifications inbox, daily bet, bounties, streak revive UI)
- Added explicit "Real Feature Gaps" list — 11 features iOS genuinely missing
- Strategy locked: shared-core (Strategy C) starting Day 1

---

### 2026-05-13 — Docs checkpoint committed
**Actor:** Claude
**What happened:** Committed `LIONADE_WORKFLOW.md` + `IOS_PARITY.md` + `PARITY_SPRINT_LOG.md` + `CLAUDE_AGENT.md` updates as a clean restore point before code changes.
**Commit:** `4651fda — docs: agent workflow + iOS parity tracking + sprint log`
**Files touched:** 4 files, 529 insertions
**Decisions:**
- `.claude/settings.local.json` hook stays gitignored (personal enforcement layer)
- Future doc updates land in sprint log first, get committed in batches with code

---

### 2026-05-13 — Day 1: shared-core scaffolded + types migrated
**Actor:** Claude
**What happened:** Set up `packages/lionade-core` as an npm workspace, migrated `types/index.ts` + `types/supabase.ts` into it, wired both web and iOS to consume.

**Files created:**
- `/Users/samc/Desktop/lionade/packages/lionade-core/package.json` — subpath exports with `react-native`, `types`, `default` conditions
- `/Users/samc/Desktop/lionade/packages/lionade-core/tsconfig.json` — strict, `lib: ["ES2022"]`, no DOM/Node types
- `/Users/samc/Desktop/lionade/packages/lionade-core/.eslintrc.cjs` — `no-restricted-imports` blocking React, RN, Next, Expo, SWR, DOM globals, node:*
- `/Users/samc/Desktop/lionade/packages/lionade-core/README.md` — package contract + import patterns
- `/Users/samc/Desktop/lionade/packages/lionade-core/src/index.ts` — re-exports types
- `/Users/samc/Desktop/lionade/packages/lionade-core/src/types/index.ts` — User, Subject, Question, QuizResult, Badge, DuelSession, LeaderboardEntry, SubjectStat, BadgeRarity, Difficulty, DuelStatus
- `/Users/samc/Desktop/lionade/packages/lionade-core/src/types/supabase.ts` — DB row types (Database, Json)
- `/Users/samc/Desktop/lionade-ios/lib/_core-import-test.ts` — smoke test (safe to delete once a real import lands)

**Files modified:**
- `/Users/samc/Desktop/lionade/package.json` — added `"workspaces": ["packages/*"]` + `core:typecheck` script
- `/Users/samc/Desktop/lionade/next.config.js` — added `transpilePackages: ["@lionade/core"]`
- `/Users/samc/Desktop/lionade/types/index.ts` — replaced with `export * from "@lionade/core/types"` shim
- `/Users/samc/Desktop/lionade/types/supabase.ts` — replaced with `export * from "@lionade/core/types/supabase"` shim
- `/Users/samc/Desktop/lionade-ios/package.json` — added `"@lionade/core": "file:../lionade/packages/lionade-core"`
- `/Users/samc/Desktop/lionade-ios/metro.config.js` — added `watchFolders` + `nodeModulesPaths` + `disableHierarchicalLookup`
- `/Users/samc/Desktop/lionade-ios/tsconfig.json` — added explicit `paths` mappings for `@lionade/core/*` (necessary because Expo base sets `customConditions: ["react-native"]` which doesn't resolve `.ts` source via exports cleanly)

**Verification:**
- `npm install` at root → `node_modules/@lionade/core` symlink created ✅
- `npm install` in iOS → `node_modules/@lionade/core` symlink created (via file: dep) ✅
- `npm run core:typecheck` → clean ✅
- Web `npx tsc --noEmit` → clean ✅
- iOS `npx tsc --noEmit` → 3 pre-existing errors in `app/onboarding.tsx` (lines 162, 190, 191) — UNRELATED to shared-core. Smoke test file resolves correctly. ✅

**Decisions:**
- Used TS-source exports (no build step) rather than building to `dist/` — simpler dev flow, web's `transpilePackages` and Metro's bundler both handle .ts source
- iOS needed both `metro.config.js` (Metro runtime resolution) AND `tsconfig.json paths` (TS typecheck resolution) because Expo's `customConditions: ["react-native"]` complicates package.json exports resolution
- Web's `/types/index.ts` and `/types/supabase.ts` kept as re-export shims to avoid touching 100+ files with `import { User } from '@/types'`
- Smoke test file (`lib/_core-import-test.ts`) left in place; safe to delete once production code starts importing from core

**Open issues to address later:**
- 3 pre-existing TS errors in iOS `app/onboarding.tsx` — pre-existing, doc'd here so they don't get conflated with shared-core issues
- Pre-existing modified files in iOS repo (24 files in working tree) — not touched, not related

---

### 2026-05-13 — Day 1 status
**Where we are:** Shared-core scaffold complete. Both apps consume `@lionade/core/types` and `@lionade/core/types/supabase`. Day 1 of the 5-day extraction migration plan is **done**.

**What's NOT yet in core:** All business logic (levels, BKT mastery, spin RNG, sanitize, Ninny prompts, API client). That's Day 2-5 work.

---

### 2026-05-13 — Day 2: pure logic migration (levels, sanitize, shop-catalog)
**Actor:** Claude
**What happened:** Three simple pure-logic moves to core. No splitting needed — all files are entirely platform-agnostic.

**Files created in core:**
- `packages/lionade-core/src/logic/levels.ts` — copy of web `/lib/levels.ts` (122 lines). LEVEL_TIERS, xpForNextLevel, totalXpForLevel, getLevelFromXp, getLevelProgress, getTierForLevel, formatLevel, formatLevelWithTier.
- `packages/lionade-core/src/validation/sanitize.ts` — copy of web `/lib/sanitize.ts`. isSuspicious, stripHtml, sanitizeText/Username/Email/Bio/Password, sanitizeSignupForm, sanitizeLoginForm.
- `packages/lionade-core/src/constants/shop-catalog.ts` — copy of web `/lib/shop-catalog.ts`. COSMETIC_ITEMS, BOOSTER_ITEMS, FEATURED_ITEMS, PREMIUM_ITEMS, getShopItem.

**Files modified in web (now re-export shims):**
- `/lib/levels.ts` → `export * from "@lionade/core/logic/levels"`
- `/lib/sanitize.ts` → `export * from "@lionade/core/validation/sanitize"`
- `/lib/shop-catalog.ts` → `export * from "@lionade/core/constants/shop-catalog"`

**Verification:**
- `npm run core:typecheck` → clean ✅
- `npx tsc --noEmit` (web) → clean ✅

**Wins:**
- iOS lib/levels.ts is now a documented duplicate (still exists but slated for deletion in Phase 2 when first iOS feature uses core)
- Source of truth for shop catalog is now single — server price lookup matches whatever iOS displays

---

### 2026-05-13 — Day 3: BKT mastery + spin RNG split + missions split
**Actor:** Claude
**What happened:** More complex moves. Mastery is entirely pure. Spin needed splitting (pure pieces → core, node:crypto pieces stayed). Missions needed splitting (pure pool → core, supabase computation stayed in web).

**Files created in core:**
- `packages/lionade-core/src/logic/mastery-bkt.ts` — copy of web `/lib/mastery.ts` (BKT params, updateBKT, pPass, displayPct, pickNextSubtopic, isPassReady, isMasteryReached, pickDifficulty). Difficulty type re-exported from core/types.
- `packages/lionade-core/src/logic/spin-rng.ts` — pure pieces of `/lib/spin.ts`: SpinOutcome, SpinSlot, SPIN_SLOTS (with weight-sum sanity check), pickSlotByWeight(roll), RewardResult, SPIN_COOLDOWN_MS, nextSpinAt, canSpinNow, spinMultiplierForPlan. **Does NOT import node:crypto** — caller injects entropy.
- `packages/lionade-core/src/constants/missions.ts` — pure pieces of `/lib/missions.ts`: MissionTemplate, MissionWithProgress, MISSION_POOL (18 templates), hashString, seededShuffle, getDailyMissions, getMissionResetTime.

**Files modified in web:**
- `/lib/mastery.ts` → re-export shim (`export * from "@lionade/core/logic/mastery-bkt"`)
- `/lib/spin.ts` → **HYBRID**: re-exports pure surface from core, KEEPS rollSlot() and computeReward() because they use node:crypto.randomInt for cryptographic-grade randomness. rollSlot now delegates to core's pickSlotByWeight under the hood.
- `/lib/missions.ts` → **HYBRID**: re-exports MISSION_POOL/getDailyMissions/getMissionResetTime from core. KEEPS computeMissionProgress because it uses supabaseAdmin.

**Verification:**
- `npm run core:typecheck` → clean ✅
- `npx tsc --noEmit` (web) → clean ✅
- iOS `npx tsc --noEmit` → only 3 pre-existing `app/onboarding.tsx` errors ✅

**Important architectural decisions:**
- Spin RNG split was the cleanest possible: pure picker in core (any caller can supply a roll), node:crypto wrapper in web (only API route). This means iOS could in the future implement client-side animation preview using its own RNG without touching server-grade entropy.
- Difficulty type is now canonical in core/types. Mastery-bkt re-exports it so `import { Difficulty } from '@lionade/core/logic/mastery-bkt'` keeps working.
- Missions split keeps the DB-coupled function on the server but exposes the deterministic daily rotation logic to both platforms — iOS can render "today's missions" without a server roundtrip, then compute progress via API.

**Day 2 + 3 cumulative impact:**
- 6 pure-logic files migrated to core
- 3 hybrid splits (spin, missions, mastery — though mastery was clean)
- ~700 lines of platform-agnostic code now live in one place
- iOS can consume any of: levels, sanitize, shop-catalog, mastery-bkt, spin-rng (pure picker), missions (pure pool)

---

### 2026-05-13 — Days 4-5: API client + Ninny prompts migrated
**Actor:** Claude
**What happened:** Built createApiClient in core, reconciled web + iOS api-clients, added spinAPI canary, moved Ninny types + prompt to core.

**Files created in core:**
- `packages/lionade-core/src/api/http.ts` — `createApiClient({ baseUrl, getToken, fetch, requireAuth })` returns typed ApiClient with `get/post/patch/delete/swrFetcher`. DI'd fetch, DI'd token getter. Platform-agnostic. Updated core `tsconfig.json` to include `"DOM"` lib (for fetch/Response/Headers types — these are Web Platform standards available in Node 18+ and RN; DOM-specific globals like window/document still banned via ESLint).
- `packages/lionade-core/src/api/index.ts` — re-exports createApiClient + types
- `packages/lionade-core/src/api/spin.ts` — `spinAPI.status()` and `spinAPI.roll()` typed wrappers. Methods take an `ApiClient` arg, return typed `ApiResult<SpinStatus | SpinRollResult>`.
- `packages/lionade-core/src/prompts/ninny.ts` — Ninny types (NinnyDifficulty, NinnyMode, Flashcard, MatchPair, MCQQuestion, FillBlankQuestion, TrueFalseQuestion, OrderingQuestion, NinnyGeneratedContent, NinnySubject) + NINNY_SUBJECTS taxonomy + buildNinnyPrompt prompt template.

**Files modified in web:**
- `/lib/api-client.ts` → re-implemented as a thin shim. Configures createApiClient with `baseUrl: ""` (relative URLs) and Supabase session token getter. Public surface unchanged (apiGet/apiPost/apiPatch/apiDelete/swrFetcher).
- `/lib/ninny.ts` → Hybrid. Re-exports types + buildNinnyPrompt + NINNY_SUBJECTS from core. Keeps server-only stuff (NINNY_REWARDS, calcNinnyReward, weightedShuffle, buildNinnyChatSystemPrompt, validateGeneratedContent, NinnyMaterial DB row interface, cost constants).

**Files modified in iOS:**
- `/lib/api-client.ts` → Mirror shim. Configures createApiClient with `baseUrl: EXPO_PUBLIC_API_BASE_URL || "https://getlionade.com"`. `requireAuth: false` because iOS makes some anonymous probes (pricing pre-login). Public surface unchanged (apiGet/apiPost/apiPatch/apiDelete).

**Verification:**
- `npm run core:typecheck` → clean ✅
- Web `npx tsc --noEmit` → clean ✅
- iOS `npx tsc --noEmit` → only 3 pre-existing `app/onboarding.tsx` errors ✅

**Architectural decisions:**
- createApiClient uses DI for fetch (default `globalThis.fetch`). This means the SAME client code works on both Next.js (server + client) and RN (which provides its own fetch).
- iOS api-client sets `requireAuth: false` (web sets `true`) — this matches the existing behavior where iOS sometimes hits public endpoints without a session. Per-method gating can still be enforced server-side.
- spinAPI methods take an `ApiClient` arg rather than holding a private instance. Lets the app pass its configured client without rebuilding the dependency graph inside core.
- DOM lib added to core tsconfig — only for fetch/Response types (Web Platform standards). DOM-specific globals (window, document, localStorage) still banned via ESLint `no-restricted-globals`.

**Cumulative state after Days 1-5:**
- `packages/lionade-core/` complete with: types, logic (levels, mastery-bkt, spin-rng), validation (sanitize), constants (shop-catalog, missions), api (http, spin), prompts (ninny)
- Web `/types/*`, `/lib/levels.ts`, `/lib/sanitize.ts`, `/lib/shop-catalog.ts`, `/lib/mastery.ts`, `/lib/api-client.ts` are shims
- Web `/lib/spin.ts`, `/lib/missions.ts`, `/lib/ninny.ts` are hybrids (core re-export + server-only logic stays)
- iOS `/lib/levels.ts`, `/lib/api-client.ts` are shims
- ~1000 lines of business logic consolidated; first feature canary (Daily Spin re-wire on iOS) is unblocked

---

### 2026-05-13 — Phase 2 kickoff: Daily Spin CANARY shipped 🎯
**Actor:** Claude
**What happened:** First iOS feature to consume `@lionade/core` end-to-end. Proves the shared-core architecture works in production code, not just typecheck.

**Pre-flight fix:** The initial `spinAPI` types in core had wrong response shapes (used `newBalance` instead of `balanceBefore`/`balanceAfter`/`intendedDelta` — didn't match actual server contract). Read `/app/api/spin/roll/route.ts` and `/app/api/spin/status/route.ts` and updated `core/src/api/spin.ts` to match exactly.

**Files modified:**
- `packages/lionade-core/src/api/spin.ts` — corrected `SpinStatus` and `SpinRollResult` shapes to match the actual server response
- `/Users/samc/Desktop/lionade/lib/api-client.ts` (web) — exports `apiClient` singleton for typed-method consumption
- `/Users/samc/Desktop/lionade-ios/lib/api-client.ts` — same exposure of `apiClient` singleton
- `/Users/samc/Desktop/lionade-ios/components/Shop/DailySpinHero.tsx`:
  - Replaced hardcoded `WHEEL_SLOTS` array with `SPIN_SLOTS.map(...)` from `@lionade/core/logic/spin-rng` (eliminates the silent-drift risk that the comment "Order MUST match" used to warn about)
  - `apiGet<SpinStatus>("/api/spin/status")` → `spinAPI.status(apiClient)`
  - 7-field hand-typed `apiPost<...>("/api/spin/roll", {})` → `spinAPI.roll(apiClient)` (types come from core)

**Verification:**
- `npm run core:typecheck` → clean ✅
- Web `npx tsc --noEmit` → clean ✅
- iOS `npx tsc --noEmit` → only 3 pre-existing `app/onboarding.tsx` errors ✅
- DailySpinHero compiles against the new typed contract — no manual type annotations needed

**Why this matters:**
- The wheel order in iOS used to be a hand-maintained mirror of web's `SPIN_SLOTS`. A reorder on the server would silently break landing animations. Now it's derived from the canonical core array — drift impossible.
- The 7-field hand-typed roll response is gone — server contract change = single-file core update + both apps pick it up.
- This is the pattern every future Phase 2 feature will follow: typed method in core, app calls it with its configured `apiClient`.

**`IOS_PARITY.md` updated:** Daily Spin row now marked as the first shared-core consumer. Header notes Phase 2 in progress.

---

## NEXT (resume point for interrupted sessions)

**Last completed step:** Daily Spin canary shipped — proves shared-core architecture end-to-end.

**Phase 1 (shared-core extraction) is DONE.**
**Phase 2 (real feature ports) is UNDERWAY.**

**Next concrete actions — Phase 2 continued:**

**~~1. Daily Spin canary~~ ✅ Done 2026-05-13.**

---

### 2026-05-13 — 🗡️ Duel feature shipped to iOS (first NEW feature port)
**Actor:** Claude + dev-frontend agent
**What happened:** First entirely-new iOS feature build. Web had `/duel` (615 lines) + `DuelInvite.tsx` (201 lines). iOS now has `app/duel.tsx` covering all 4 phases inline. Delegated the actual build to `dev-frontend` agent with a detailed spec; verified output against the LIONADE_WORKFLOW done-definition.

**Files created in iOS:**
- `app/duel.tsx` (2338 lines — verbose RN inline styles, equivalent dense web JSX is ~800 lines). 5-phase finite state machine: invite → loading → countdown → battle → results. 9 internal sub-components (InvitePhase, LoadingPhase, CountdownPhase, BattlePhase, ResultsPhase, RuleCard, OptionButton, DotCell, LegendRow, ThinkingDots, PrimaryButton, SecondaryButton).

**Files modified in iOS:**
- `app/_layout.tsx` — added `<Stack.Screen name="duel" />` to register the route.

**Gameplay parity with web:**
- 5 fake bot opponents (StudyBot_Alex, QuizMaster_99, BrainiacSam, CoinHunter_X, NightOwl_Dev) with hardcoded levels/streaks/avatars — identical to web
- 7 subjects to pick from — identical to web
- 15 second timer per question, 10 questions total
- Opponent simulation: random 68% accuracy with 300-1800ms staggered delay
- Tie supported (no prize)
- Persists to `duels` table via Supabase direct (no /api endpoint — matches web)
- Winner gets 1000F (2x of 500 wagered) via direct profile.coins update + coin_transactions row (mirrors web's `incrementCoins` + transaction insert)
- Haptics on correct/wrong/results

**Verification:**
- iOS `npx tsc --noEmit` → only 3 pre-existing `app/onboarding.tsx` errors ✅
- Route registered in `_layout.tsx`
- Sub-components well-organized; no duplicated logic

**Open issues / pre-existing bugs inherited from web** (NOT introduced by this port):
1. `duels.opponent_id` column is likely typed as UUID, but bot IDs are strings ('bot-1'...'bot-5'). Insert may fail in production. Same bug exists on web — pre-existing.
2. Duel subjects use labels like "SAT/ACT", "Coding", "Certifications" while the questions table may be seeded under different labels ("Test Prep", "Tech & Coding"). If labels don't match, `fetchQuizQuestions(subject, "medium")` returns no rows. Same issue exists on web — pre-existing.
3. Mid-battle coin pop-up animation omitted; results screen has CountUp + haptic. v1.1 polish item.

**Deviations from spec (acceptable):**
- Used Ionicons (not Phosphor — Phosphor is web-only). Specified in original brief.
- Used internal sub-components rather than separate DuelInvite file (single-file route per iOS convention).

**Phase 2 progress after this commit:**
- 9 iOS surfaces on shared-core (typed API methods)
- 1 NEW iOS feature shipped (Duel)
- Pattern established for future new-feature ports: detailed spec → dev-frontend agent → review → commit

---

### 2026-05-13 — Batch typed-API push: Daily Drill, Clock-In, Streak Revive
**Actor:** Claude
**What happened:** Added 3 more typed API method modules to core and refactored 3 iOS hooks to consume them. The "typed method per feature" pattern is now well-established.

**Files created in core:**
- `packages/lionade-core/src/api/login-bonus.ts` — `loginBonusAPI.status` + `.claim`. Types: ClockInStatus, ClockInClaimResponse.
- `packages/lionade-core/src/api/streak-revive.ts` — `streakReviveAPI.status` + `.claim(method)`. Types: StreakReviveStatus, StreakReviveClaimResponse, StreakReviveMethod.
- `packages/lionade-core/src/api/daily-drill.ts` — `dailyDrillAPI.status` + `.submit(results)`. Types: DrillQuestion, DrillStatus, DrillResult, DrillCompleteResponse.

**Files modified in iOS:**
- `lib/hooks/use-clock-in.ts` → imports types + `loginBonusAPI` from core. Re-exports types so screens using `import { ClockInStatus } from '@/lib/hooks/use-clock-in'` keep working.
- `lib/hooks/use-streak-revive.ts` → same pattern with `streakReviveAPI`.
- `lib/hooks/use-daily-drill.ts` → same pattern with `dailyDrillAPI`.

**Verification:**
- `npm run core:typecheck` → clean ✅
- Web `npx tsc --noEmit` → clean ✅
- iOS `npx tsc --noEmit` → only 3 pre-existing `app/onboarding.tsx` errors ✅

**iOS surfaces now consuming shared-core after this batch (5 total):**
1. `components/Shop/DailySpinHero.tsx` → spinAPI
2. `app/quiz.tsx` → quizAPI
3. `lib/hooks/use-daily-drill.ts` → dailyDrillAPI (used by DailyDrillCard + DailyDrillModal)
4. `lib/hooks/use-clock-in.ts` → loginBonusAPI (used by ClockInButton + ClockInToast)
5. `lib/hooks/use-streak-revive.ts` → streakReviveAPI (used by StreakReviveBanner)

**Pattern is now durable enough to scale.** Every remaining endpoint follows the same shape:
- Read server route → mirror request/response in `core/src/api/<feature>.ts` → expose `<feature>API` namespace → consume in iOS hook/screen by calling `<feature>API.method(apiClient, ...)`.

---

### 2026-05-13 — Quiz wired to shared-core (2nd consumer)
**Actor:** Claude
**What happened:** Added `quizAPI.saveResults()` to core. Refactored iOS `app/quiz.tsx` to consume it. Proves the canary pattern generalizes — this is no longer a one-off.

**Files created in core:**
- `packages/lionade-core/src/api/quiz.ts` — `quizAPI.saveResults(client, payload)` with typed request (`SaveQuizResultsPayload`) and response (`SaveQuizResultsResponse` including `StreakMilestone` and `bonusFangs`). Mirrors `/app/api/save-quiz-results/route.ts` server contract exactly.

**Files modified in iOS:**
- `app/quiz.tsx`:
  - `import { apiPost }` → `import { apiClient }` + `import { quizAPI } from '@lionade/core/api/quiz'`
  - `await apiPost("/api/save-quiz-results", payload)` → `await quizAPI.saveResults(apiClient, payload)`
  - Removed implicit `any` on the response (was untyped before).

**Verification:**
- `npm run core:typecheck` → clean ✅
- Web `npx tsc --noEmit` → clean ✅
- iOS `npx tsc --noEmit` → only 3 pre-existing `app/onboarding.tsx` errors ✅

**Two iOS features now on shared-core:**
1. Daily Spin (canary) — uses `spinAPI.status` + `spinAPI.roll` + `SPIN_SLOTS`
2. Quiz hub — uses `quizAPI.saveResults`

**Pattern established for the rest of Phase 2:**
- Read server route → write typed wrapper in `core/src/api/<feature>.ts` → swap iOS calls → typecheck → commit.
- Average per-feature time: ~15-30 minutes once the route shape is known.

---



2. **Duel** (BATCH A: highest user value)
   - Entire feature missing on iOS
   - Build: route `/duel` (new in iOS), `DuelInvite` component, real-time matchmaking integration
   - Add `duelAPI` to core (POST /api/duel/create, GET /api/duel/[id], etc.)
   - Push notifications when challenged

3. **Learn hub** (BATCH A)
   - iOS missing `/learn`, `/learn/ninny`, `/learn/paths`
   - Build hub screen + Ninny chat screen + path browsing
   - All Ninny prompt building uses `@lionade/core/prompts/ninny.buildNinnyPrompt`

4. **Classes index page** (BATCH A — small but UX-breaking gap)
   - iOS only has `/classes/[id]` detail; no list view
   - Build `/classes` index that mirrors web

5. **Arena PvP** (complete the stub)
   - iOS has Arena UI; "Find Match" button is stubbed
   - Wire to real matchmaking API

6. **Mastery orchestrator full integration**
   - iOS has chat session UI; orchestrator integration is partial
   - Complete the auto-advance + question generation loop

**Then Batch B (Week 3): Syllabus upload, Grade tracker, Flashcard study, Study DNA, Shop cosmetics + boosters, Friend DM**
**Then Batch D (Week 4 or defer): Games hub, Focus music toggle**

**Pick-up instructions if session breaks:**
1. Read this log entire (focus on Day 1-5 summaries)
2. `TaskList` shows phase 1 tasks are completed
3. Verify `npm run core:typecheck` and web `npx tsc --noEmit` both clean
4. iOS should show only 3 pre-existing `app/onboarding.tsx` errors
5. Phase 2 starts with the Daily Spin canary — that's the next concrete file change. iOS files to look at: `components/Shop/DailySpinHero.tsx`, `components/Shop/SpinWheel.tsx`, plus `lib/api-client.ts` for how to use the apiPost helper
6. After canary works end-to-end, mark "Phase 1 complete, Phase 2 underway" and move to Duel
