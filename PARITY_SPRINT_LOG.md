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

## NEXT (resume point for interrupted sessions)

**Last completed step:** Synthesis of agent outputs into refined Phase 1 plan.
**Currently in progress:** About to correct `IOS_PARITY.md` based on the iOS explorer's findings (many features marked ❌ are actually ✅).
**Next concrete actions (in order):**
1. Correct `IOS_PARITY.md` with accurate iOS status from explorer findings
2. Pause and confirm direction with user before scaffolding `packages/lionade-core`
3. Scaffold workspace + package.json + tsconfig + tsup
4. Move `types/index.ts` and `types/supabase.ts` into core (Day 1 of migration plan)
5. Wire web imports through `@lionade/core/types`
6. Add metro.config.js update on iOS side
7. Continue Day 2-3: pure logic moves (levels, mastery BKT, sanitize, spin RNG split)

**Pick-up instructions if session breaks:** Read this entire log. Check `TaskList` for `Synthesize agent outputs into Phase 1 plan` task status. If `completed`, proceed to "Next concrete actions" above. If session needs to re-spawn agents, prompts are reconstructible from the log entries above.
