# IOS_PARITY.md — Web ↔ iOS Feature Drift Tracker

**Updated by `quality-docs-writer` after every shippable web change.**
**Web repo:** `~/Desktop/lionade` · **iOS repo:** `~/Desktop/lionade-ios`

Legend: ✅ shipped · 🟡 partial · ❌ missing · 🚫 N/A (web-only by design, or replaced by native UX)

**Last full audit:** 2026-05-13 (by Explore agent, see `PARITY_SPRINT_LOG.md`).
**Phase 1 (shared-core extraction):** ✅ Complete — `@lionade/core` consumed by both apps.
**Phase 2 (feature ports):** 🟡 In progress — 9 iOS surfaces on shared-core + 1 NEW iOS feature shipped (Duel) (2026-05-13):
1. **Daily Spin** (`Shop/DailySpinHero`) → `spinAPI` + `SPIN_SLOTS`
2. **Quiz** (`app/quiz.tsx`) → `quizAPI.saveResults`
3. **Daily Drill** (`use-daily-drill` hook) → `dailyDrillAPI`
4. **Clock-In / Login Bonus** (`use-clock-in` hook) → `loginBonusAPI`
5. **Streak Revive** (`use-streak-revive` hook) → `streakReviveAPI`
6. **Missions** (`use-missions` hook) → `missionsAPI`
7. **Bounties** (`use-bounties` hook) → `bountiesAPI`

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
| Login | `/login` | `/login` | ✅ | ✅ | email + Apple auth on iOS |
| Onboarding | `/onboarding` | `/onboarding` | ✅ | ✅ | 5-step wizard on iOS |
| Academia onboarding | `/academia/onboarding` | folded into `/onboarding` step | ✅ | ✅ | |
| **Home & Dashboard** | | | | | |
| Landing page | `/` | (n/a) | ✅ | 🚫 | iOS opens to tabs by design |
| Home tab | `/home` | `(tabs)/index` | ✅ | ✅ | full dashboard: drill, missions, bounties, weekly chart, stat orbs |
| Dashboard (separate) | `/dashboard` | (merged into home) | ✅ | 🚫 | KILL on web — merge into /home |
| **Learning** | | | | | |
| Learn hub | `/learn` | (none) | ✅ | ❌ | port pending |
| Learn → Ninny | `/learn/ninny` | (none) | ✅ | ❌ | port pending |
| Learn → Paths | `/learn/paths` + `/[subject]` | (none) | ✅ | ❌ | port pending |
| Learn → Mastery | `/learn/mastery` + `/[examId]` | `/mastery` + `/mastery/[examId]` | ✅ | 🟡 | iOS chat session exists, orchestrator integration partial |
| **Practice** | | | | | |
| Quiz hub | `/quiz` | `/quiz` | ✅ | ✅ | full flow on iOS — **wired to `@lionade/core/api/quiz.quizAPI.saveResults`** (2nd shared-core consumer) |
| AP Exams quiz | `/quiz/ap-exams` | (n/a) | ✅ | 🚫 | FOLD into `/quiz` as filter on both platforms |
| Arena | `/arena` | `/arena` | ✅ | 🟡 | iOS UI + ELO + recent matches done; "Find Match" stubbed |
| **Competitive** | | | | | |
| Duel | `/duel` | `app/duel.tsx` | ✅ | ✅ | **NEW iOS feature shipped 2026-05-13** — 5-phase flow (invite → loading → countdown → battle → results), simulated bot opponents, Supabase-direct duels persistence + winner Fangs payout |
| Compete tab | `/compete` | `(tabs)/compete` | ✅ | ✅ | ELO hero, 4 game modes, top 3 leaderboard |
| Leaderboard | `/leaderboard` | `/leaderboard` | ✅ | ✅ | top 50 with podium |
| **Classes** | | | | | |
| Classes index | `/classes` | (none) | ✅ | ❌ | port pending — iOS detail exists, no list |
| Class detail | `/classes/[id]` | `/classes/[id]` | ✅ | 🟡 | iOS has countdown + notes; missing syllabus upload, flashcards, grade tracker |
| Syllabus upload | `components/Class/SyllabusUpload.tsx` | (none) | ✅ | ❌ | port pending — camera-native fit |
| Exam countdown | `components/Class/ExamCountdown.tsx` | inline in academia tab | ✅ | 🟡 | iOS has inline countdown; standalone component port pending |
| Grade tracker | `components/Class/GradeTracker.tsx` | (none) | ✅ | ❌ | port pending |
| Flashcard study | `components/Class/FlashcardStudy.tsx` | (none) | ✅ | ❌ | port pending |
| **Academia** | | | | | |
| Academia hub | `/academia` | `(tabs)/academia` | ✅ | ✅ | classes grid, countdown, notes, empty state |
| **Social** | | | | | |
| Social tab | `/social` | `(tabs)/social` | ✅ | 🟡 | friends list works; friend DM not implemented |
| **Identity** | | | | | |
| Profile | `/profile` | `(tabs)/profile` | ✅ | ✅ | hero portrait, 4 stat tiles, 3 segments |
| Badges | `/badges` | `/badges` | ✅ | ✅ | full gallery with rarity rings |
| Study DNA | `/study-dna` | (none) | ✅ | ❌ | port pending |
| **Economy** | | | | | |
| Shop | `/shop` | `/shop` | ✅ | 🟡 | iOS has Daily Spin hero; cosmetics + boosters stubbed "Coming soon" |
| Daily Spin | `app/api/spin/roll` + UI | `Shop/DailySpinHero` + `SpinResultModal` + `SpinWheel` | ✅ | ✅ | **Shared-core wired** — first canary feature, uses `spinAPI` + `SPIN_SLOTS` from `@lionade/core` |
| Wallet | `/wallet` | `/wallet` | ✅ | ✅ | balance + lifetime + transaction history |
| **Settings** | | | | | |
| Settings | `/settings` | `/settings` | ✅ | ✅ | font, notifications, privacy |
| Subscription | `/settings/subscription` | (StoreKit deep-link) | ✅ | 🚫 | iOS uses Apple manage-subscription URL |
| Pricing | `/pricing` | `/pricing` | ✅ | ✅ | full plans on iOS, monthly/annual toggle |
| **Gamification** | | | | | |
| Games hub | `/games` | (none) | ✅ | ❌ | port pending (Batch D — nice to have) |
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
