# Worklog - cross-machine session handoff log

This is the handoff note between machines. When you pull on another computer and ask Claude **"what was the last thing I did,"** this file is the answer (Claude is pointed here from CLAUDE.md). Newest entry first. If you can read the entry below on a freshly pulled machine, the pull worked.

---

## 2026-07-07 (RELIABILITY BATCH DEPLOYED + 3 next-things) - the whole works-when-tapped wave is LIVE on getlionade.com, plus Review Hub active-recall / Resume Coach fixed for real / competitive honest error states, all deployed

**Two prod deploys shipped this session (both `vercel deploy --prod`, aliased to getlionade.com).** The CEO deploy gate was "deploy once you verify all our systems have backend and clicking doesn't error" - verified (prod build green 379 routes, prod schema diff'd against code on every economy/cosmetics table, live smoke test 200s) then shipped.

- **Deploy 1 (commit `c1da0b8`, main pushed):** the entire ~15-commit CEO-feature-freeze reliability batch from 2026-07-06 (schema-drift wave, shop `user_inventory` rebuild, avatar circle-fit, badges backend, ~50 dead-button fixes) PLUS the arena FIND MATCH queue-join error state (`c1da0b8`). This is the batch that was "on main, NOT deployed" in the two entries below - it is now LIVE.
- **Deploy 2 (commit `213ba94`, main pushed):** the 3 CEO-picked next-things -
  - **Review Hub "make your guess"** (`app/learn/review/page.tsx`) - optional active-recall guess box before the flashcard reveal; guess shown next to the answer for honest self-grading. Zero API. **iOS port pending** (iOS has Review Hub; mechanical port, IOS_PARITY row added).
  - **Resume Coach fixed FOR REAL** - swapped fragile `pdf-parse` v2 (needed `@napi-rs/canvas` + fake pdfjs worker force-traced into the lambda; was runtime-dead in prod, died before the AI call) for **`unpdf`** (serverless pdf.js, no canvas/worker/native deps). Deleted the `outputFileTracingIncludes` hack + `serverComponentsExternalPackages` from `next.config.js`. Same fix restores the **syllabus parser**. **iOS Resume Coach + syllabus get this for FREE** (shared server route). `npm i unpdf` (1.6.2), verified API via Context7.
  - **Competitive honest error states** (`components/competitive/{sabotage,zoom,spectrum}`) - a failed `/answer` POST now shows "connection issue · didn't count · +0" instead of mislabeling a network blip as a miss (mirrors PinScreen's existing `scoreFailed` card); still advances to keep both players in lockstep. Competitive is not in iOS v1, so 🚫 N/A there.

**Verified discrepancy (flagged + memory corrected):** TechHub whole-shift completion is a LIVE Fangs faucet now - the held `techhub_shift_completions` migration (`20260626120000`) was applied since the notes said "preview-only." The table exists on prod; the grant route is SAFE (server-authoritative, per-shift ceiling clamp, best-score top-up, double-pay-safe via optimistic concurrency - bounded to each shift's ceiling once, not infinite). Per-ticket resolves stay practice-only (CEO decision).

**Docs:** IOS_PARITY 2026-07-07 section added (3 rows); vault `Daily/2026-07-07.md` written (Obsidian REST API was down, wrote the file directly); `project-techhub-liondesk` memory corrected. iOS build 29 still NOT built (awaits literal "build it"; rides the Review-Hub-guess port + the dead-button iOS tail).

---

## 2026-07-06 (dead-button hunt) - CEO directive "no button not working": audited EVERY interactive element on both platforms (2301 traced), fixing dead/fake/broken/misleading ones - P0s + main-path P1s done, long tail tracked

**Two systematic audits ran (web + iOS), each tracing every button/link/handler/Pressable to a real action against a ground-truth route list.** Web: 1346 elements, 68 findings. iOS: 955 tap targets, 42 findings. The fix + heal + review sub-agents hit a hard usage cap mid-run (resets 2026-07-12), so the FIXES were applied partly by the sub-agents before they died and partly BY HAND in the main loop afterward. Everything committed is tsc-clean; web also passed `next build` (needs `NODE_OPTIONS=--max-old-space-size=6144` - the default OOMs and fake-fails on /api/academia/agenda).

**Commits (all on main, NOT deployed; DB migrations from earlier waves ARE applied):**
- WEB `2a92dd5` - 29-file batch from the sub-agents. All 3 web P0s: BlitzMode read stale score from a mount-time closure (every Blitz run paid 0 Fangs) -> refs; contact form 3 of 6 categories 400'd (missing from API whitelist) -> added; pricing 'Plan unavailable' now honest 'billing setup' copy not a dead retry. Plus many P1/P2: quiz/drill/QuizCard answer-fail states, leaderboard retry, Focus Lock-In/music honesty, mastery+StudySheet 'Upgrade' -> /pricing (were no-ops), LaunchDock tooltip realign, classes plan refresh + deep link.
- iOS `d2d9e44` - 10-file batch (rides build 29): quiz honest submit-error instead of fabricated reward, Bounties 'already claimed' not treated as failure, mastery chips/Socratic/delete failure states, party PLAY AGAIN + Sketch pick + RoomLobby close error feedback, vocab review + paths retry.
- WEB `fcdad50` (by hand) - leaderboard 'Try again' was setFilter(filter) no-op -> real reloadKey refetch; arena challenge username validation stripped '%_' + rejected hyphens (same trap as friends) -> /^[a-z0-9._-]{3,31}$/; social accept/decline + cancel now surface errors; notification rows mark-read on tap (were dead for no-action_url notifs).
- WEB `0065b28` (by hand) - profile Delete Account modal claimed immediate permanent deletion but the route SCHEDULES 24h out with a cancellable grace window -> honest copy + toast; shop 'Buy x5 save 10%' displayed a discounted price the server did NOT charge (user overpaid) -> server now applies the 10% for booster bundles >=5.

**REMAINING (tracked long tail, mostly P2 'add a failure toast/state on !ok', a few P1):** WEB - shop Fang-pack Stripe honesty, competitive screens (zoom/spectrum/sabotage/arena FIND MATCH answer-fail), profile privacy/notif save-traps + personalization + download-data, waitlist copy, forgot-password. iOS - arena.tsx (leave-queue/answer-fail/results/quit), wallet cash-out gate, badges tap, profile subscription rows, app-icon fake 'Saved', notifications web-only action_urls, **login Google OAuth callback (BROKEN_ROUTE - no app/auth/callback.tsx; touch carefully, it's auth)**, settings subscription, chat presence dot, CosmeticLocker equip, Email/Password cards for OAuth-only accounts. Full finding lists in the two workflow outputs. Sub-agents resume 2026-07-12; until then this is hand-work.

---

## 2026-07-06 (reliability wave) - CEO FEATURE FREEZE: works-when-tapped audit (344 interactions, 26 breaks) + cross-platform fix wave + live click-verification + SHOP PURCHASES REPAIRED (they had NEVER worked on prod) + avatar alignment (all on main, 3 migrations APPLIED to prod, web deploy still Sam-gated)

**The headline: Sam called a feature freeze ("make everything that exists work when tapped"), and the wave surfaced + fixed real production breakage, including shop purchases, which had NEVER worked on prod.** Everything below is verified live and committed on **main**. **NOT yet deployed to web prod (the ONE deploy is Sam-gated), EXCEPT the three DB migrations, which ARE applied to prod** - so the DB-side fixes (shop, avatars, badges backend) are already live for prod and iOS build 28 with no deploy needed.

**Works-when-tapped audit + fix wave (web `70565e2` + iOS `1295358`):** 344 interactions audited, 26 confirmed breaks, then the fixes: bounties hook, recent-quizzes, quiz deriveReward + attemptId + a double-tap latch, claim-bounty/daily-drill rollback on credit failure, friends username charset + revive, mastery archive endpoint, the badges backend (migration `20260706120000` APPLIED: 12-badge catalog + 17 retro-awards; award wiring in save-quiz-results/friends/publish/shifts/vocab), and the resume-coach pdf-parse root cause on Vercel tracing (DOMMatrix/@napi-rs + pdfjs fake worker; `next.config.js` outputFileTracingIncludes).

**Interactive click-verification (the "verified live" half):** on web, a demo account drove the full quiz loop with a LIVE badge award proven on the badges page (First Blood), daily claim (+10, dual ledger), review-hub grade (+2), spin (200), helpdesk clear-queue resolves (+40), party room create/close over realtime, and shop affordability gating. On iOS, Maestro ran 6/6 driving demo login, the full Academia funnel, and LionDesk clock-in through to the live HUD. Live-found fixes along the way: streak-shield legacy-column 400 (`3f2061a`), double navbar on 7 surfaces (`f12cc18`, `171a672`), leftover "coins" strings corrected to Fangs (`f5b6fed`).

**Sam's two live reports, both fixed + verified (`fcfa6e0`):**
- **(a) SHOP PURCHASES HAD NEVER WORKED ON PROD.** `user_inventory` was an ancient uuid scaffold; every buy went debit -> insert-fail -> auto-refund -> 500, and the table had ZERO rows ever. Rebuilt via migration `20260706180000` (APPLIED); first successful purchase verified end to end (debit 622 -> 472 + inventory row + ledger entry). The fix is DB-side, so prod AND iOS build 28 work immediately.
- **(b) Avatars misaligned in their circles.** avataaars renders top-anchored; `scale=80&translateY=6` verified visually. Stored avatar URLs migrated (`20260706190000` APPLIED, so iOS is fixed too) + five web avatar generators updated.

**IN FLIGHT as this entry is written (results land in a later entry):** a systematic schema-drift hunt - every web DB touchpoint checked against the live prod schema; drift is the class behind five of tonight's bugs - plus seven more fix lanes: shop drops duplicate key, spend-RPC iap clamp migration, resume machine error codes, friends dupe revive, favicon/hydration dev noise, achievements wiring investigation, learning-paths honest empty state.

**Still user-gated:** the ONE web deploy (Sam approves after verification; `vercel deploy --prod` is manual), Ninny send + IAP + the learning-paths retire-vs-seed decisions, EAS build 29.

---

## 2026-07-06 (second batch) - VERIFIED LOCALLY, THEN SHIPPED: Maestro 6/6 GREEN on a signed sim build (waves 3-5 verification debt DISCHARGED) + BUILD 28 BUILT + SUBMITTED to TestFlight + auth boot fail-open + web helpdesk no-dead-ends + Resume Coach error surfacing

**The headline: build 28 (v1.0.0) is ON TESTFLIGHT** (EAS build `c219c314`, submission `7aaeffad`, buildNumber auto-incremented 27->28) — Sam's go was "verify locally first, then build it," and both halves happened this session. Contents: the 2026-07-04 Party batch + parity waves 3-5 + the finish wave + `405f290` + `9cab1b4`, shipped from `release/testflight-03` fast-forwarded to the wave4 tip.

**Verification (the "verify locally" half):** built a signed Release sim build via raw `xcodebuild` (ad-hoc `CODE_SIGN_IDENTITY="-"`), installed on an iPhone 17 Pro sim, and ran the full Maestro suite **6/6 GREEN**: smoke, techhub-shift (complete LionDesk path through Clock-in to the live HUD), study-sets, library-share, resume-coach, academia-setup. Screenshots confirmed Study home (gold #FFD700 Fangs, Daily Drill) + Games tab. **The waves 3-5 MERGED-BUT-UNVERIFIED banner below is DISCHARGED.** Remaining nicety: a physical-device VoiceOver + Dynamic Type walkthrough + a quick TestFlight smoke of build 28 once Apple finishes processing.

**Three local-build gotchas on the record (docs/CHANGELOG.md has the full story):** `CODE_SIGNING_ALLOWED=NO` strips the keychain entitlement -> SecureStore fails -> `getSession()` hangs -> infinite boot spinner that looks exactly like an app bug (fix: ad-hoc signing); `expo run:ios --device <sim-udid>` mis-routes to the physical-device path under Xcode 26.5 (drive xcodebuild directly); local Release builds need `SENTRY_DISABLE_AUTO_UPLOAD=true`.

**Real fixes that fell out:** iOS `405f290` auth fail-open (getSession had no .catch — any Keychain rejection bricked boot forever) + `e3f91ef` retry-then-fail-open + Maestro assertion tightening (rides the NEXT build, not 28). iOS `9cab1b4` Maestro selectors reconciled to the real a11y tree (grouped labels are full-string-regex targets; the demo account is live Platinum, not seeded-free). WEB (from Sam's live testing mid-session): `43e5482` helpdesk terminal no-dead-ends (forgiving matching + did-you-mean + escalating rescue), `577fdff` Resume Coach real error surfacing (diagnosed via ai_call_log: zero analyze rows ever = the route dies in PDF extraction, key + plan are fine), `e87a1dc` review must-fixes (two-pass exact-then-prefix command matching — a shorter alias was shadowing later commands, worst case the bad-deploy rookie trap PAID OUT a resolve; + em-dash purge). **Web fixes are committed but NOT deployed to prod (Sam hasn't said deploy; `vercel deploy --prod` is manual).**

**Parity rows added:** web helpdesk no-dead-ends -> iOS ❌ (must be ported into TerminalPanel, will NOT arrive via re-vendor); Resume Coach error mapping -> iOS 🟡. **Open Sam threads:** deploy web fixes to prod? Review Hub "make your guess" active-recall step (fork: True/False buttons vs self-graded commit-then-reveal).

---

## 2026-07-06 (finish wave) - Wave-4/5 polish + a11y cap: two-golds RESOLVED, DailyDrill calm pass, crash-safe share-card, Maestro CI, VoiceOver + Dynamic Type sweep (committed, NOT pushed; build 28 still PREPPED, pending Sam's go) — verification-on-device debt still the dominant open item

**Repo:** `~/Desktop/lionade-ios`. **Branch: `feat/ios-web-parity-wave4` — committed, NOT pushed, NOT built, NOT on TestFlight.** Build 28 status unchanged (still PREPPED on `release/testflight-03`, gated on Sam's explicit go). Four iOS commits (`07cdb71`, `5f4d111`, `747f2da`, merge `3c56fdc`) + doc commits. This is the polish/a11y cap on the wave-5 batch below — it discharges several of that entry's "open decisions / deferrals," it does NOT open new feature work.

**What shipped (5 items, all polish/reliability, zero AI/money risk):**
- **(1) Two-golds RESOLVED (`07cdb71`).** `lib/theme.ts` `FANG_CURRENCY_GOLD` re-pointed `#E0A73E → #FFD700` — the web-canonical Fang gold (DESIGN.md §0/§1; the shade shipped iOS screens already rendered inline). The wave-5 "needs Sam" open decision is closed. Revert is a one-line change if a warmer iOS gold is ever wanted as deliberate divergence.
- **(2) DailyDrillCard calm pass (`5f4d111`).** `components/DailyDrillCard.tsx` migrated off arcade tokens onto calm: GlassCard→CalmCard, BebasNeue→Inter, electric `#4A90D9`→`calm.accent #33B1FF`, gold trophy→accent, VoiceOver props. Discharges the wave-5 "DailyDrillCard owes a calm pass" deferral.
- **(3) Crash-safe share-card (`5f4d111`).** `components/ShareCard.tsx` now lazy-loads `react-native-view-shot` via `loadCaptureRef()` (require-in-try/catch) instead of a top-level import that would crash a binary lacking the native module; falls back to text `Share.share`. Bounties/share-card is now safe to ship on the current binary (image export still 🟡 pending the dep + rebuild).
- **(4) Maestro E2E CI (`5f4d111`).** New `.github/workflows/maestro-smoke.yml` runs `maestro test .maestro` against a fresh `npx expo run:ios --configuration Release` on macos-14 (PR + workflow_dispatch). The wave-5 Maestro harness now has an automated runner.
- **(5) A11y + Dynamic Type sweep (`747f2da`/`3c56fdc`).** VoiceOver labels/roles/states + `maxFontSizeMultiplier` caps + `accessibilityLiveRegion="polite"` across Academia, Arena, Missions, TechHub (track/ticket/shift/shifts), AcademiaPlanner, AdPanel, ShiftResults. Perf riders: ShiftResults `useMemo` re-keyed to `state.items` (not whole state); Academia NotebookCard memoized — both stop TICK-driven full-subtree re-renders.

**Quality gate:** tsc clean on the merged tree; ios-code-reviewer pass on ShareCard (caught + fixed the original top-level-import crash) + the a11y sweep (minor-issues, no blocking). All four worktrees from the wave merged with disjoint files (no conflicts) and were removed.

**Still open (unchanged by this polish wave):** ⚠️ waves 3-5 + this cap remain MERGED-BUT-UNVERIFIED ON DEVICE — the simulator auth session is still lost, so nothing has been played on a device. **Closing that is the single highest-value next action:** `maestro test .maestro/smoke.yaml` (then `techhub-shift.yaml` + the 4 per-feature flows) + a manual VoiceOver + 1.4x Dynamic Type walkthrough against a fresh build. Build 28 EAS build/submit and the AI features (Ninny send, Mastery study sheet) remain user-gated.

**Docs updated:** `lionade-ios/docs/CHANGELOG.md` + `FEATURES.md` (2026-07-06 finish-wave entry), `IOS_PARITY.md` (two-golds RESOLVED, DailyDrill calm discharged, share-card crash-safe note, Maestro CI + a11y sweep no-row), vault `Daily/2026-07-05.md` (appended finish-wave section) + `Tech-Debt.md`.

---

## 2026-07-05 (fourth batch) - Web-to-iOS parity wave 5 + LionDesk wave 2: surface Daily Drill/Missions/Bounties + full 5-shift helpdesk campaign + multi-track LionDesk + deep-screen DESIGN.md + shift-shell perf + Maestro E2E harness (committed, NOT pushed; build 28 still PREPPED, pending Sam's go) — ⚠️⚠️ MERGED-BUT-UNVERIFIED ON DEVICE (waves 3-5)

**Repo:** `~/Desktop/lionade-ios` (the iOS app, separate repo). **Branch: `feat/ios-web-parity-wave4` — committed, NOT pushed, NOT built, NOT on TestFlight, NOT on `release/testflight-03`.** Batched per the build-on-command standing order. **Build 28 status unchanged: still PREPPED on `release/testflight-03` from the 2026-07-04 Party batch, NOT yet run/submitted, gated on Sam's explicit go.** Seven primary iOS commits (+ merge commits), `fcaf2d2..HEAD`. This is the FIFTH parity wave + the SECOND LionDesk wave, stacking on the wave-3/wave-4/design-system batches below.

**The commits (`git log --oneline fcaf2d2..HEAD`):**
- `3807f57` chore(test): Maestro E2E smoke harness (demo-login critical path)
- `2d27910` feat(engagement): surface Daily Drill + standalone Missions
- `095ad50` feat(techhub): LionDesk wave 2 - full helpdesk campaign + rich results
- `e91f6ad` feat(design): apply DESIGN.md to Arena, Profile, Badges, Wallet
- `2ad8b0d` feat(techhub): multi-track LionDesk campaigns (SOC/SWE/redteam/netops)
- `cf1ecd7` perf(techhub): stop the LionDesk shift re-rendering every tick
- `56e8fc7` feat(engagement): mount Bounties + Maestro per-feature flows + Missions offline
- (+ merge commits)

## 🚨🚨 VERIFICATION DEBT — WAVES 3, 4, AND 5 ARE MERGED-BUT-UNVERIFIED ON A DEVICE 🚨🚨

The simulator auth session was lost this session (the same loss that cost waves 3-4 their screenshot pass), so **waves 3, 4, AND 5 all shipped tsc + review-clean but with ZERO on-device / on-simulator run — nothing in these three waves has actually been played on a device.** This is the single most important open item across the whole day's iOS work. **The Maestro harness (`3807f57`, shipped THIS wave) is the deliberate lever to CLOSE it: `maestro test .maestro/smoke.yaml` (then `techhub-shift.yaml` + the 4 per-feature flows) against a fresh build once one is on a device/simulator.** Until that run happens, treat waves 3-5 as compile-and-review-clean but NOT known-to-work. Blocking-for-done.

**What shipped (5 things):**
- **(1) Engagement — three built-but-unmounted surfaces now MOUNTED (zero AI/money risk):** Daily Drill on the Study home (`2d27910`), a new standalone `/missions` screen with a server-authoritative claim + offline last-good states (`2d27910` + `56e8fc7`), and the Bounties card (`56e8fc7`). **Daily Bet + Spin stay deliberately DORMANT — App Store 5.3 wager risk, a policy call for Sam, not an oversight.** Three real parity rows.
- **(2) LionDesk wave 2 — the phase-2 deferral mostly DISCHARGED:** the full 5-shift helpdesk campaign vendored (shifts 2-5, a complete Intern-to-senior campaign) + a rich RESULTS screen (synthesized manager debrief, fumble review, quick recall, replay stepper) (`095ad50`); then MULTI-TRACK breadth — all 8 SOC/SWE/redteam/netops shift files vendored, a per-track `campaigns.ts` manifest, the shift picker un-guarded to ALL 5 tracks (`2ad8b0d`). LionDesk on iOS is now multi-track. **Still deferred (deliberate, not gaps): the meta layer only (dailies/shop/exam/leaderboard/achievements/themes).** Folds into the wave-3 TechHub row (dated wave-5 note).
- **(3) Perf — the LionDesk shift shell was re-rendering its whole subtree every ~1s TICK; memoized `StatusStrip`/`BridgeStrip`/`AppDock`/panels/`WorkView` + sliced props to primitives so a tick reconciles ONLY the clock (`cf1ecd7`).** iOS-native, no row.
- **(4) DESIGN.md depth pass on Arena/Profile/Badges/Wallet + badges standardized purple `#A855F7` (`e91f6ad`).** Extends the design system past the 4 tab roots. **Deliberately NOT touched: Leaderboard/Academia/Blitz/Pardy already reference-quality; Mastery/Study-DNA kept quiet on purpose (calm-surface carve-out).** iOS-native restyle, web is the source, no row.
- **(5) Maestro E2E harness (`.maestro/`, `3807f57`) — the verification lever.** Zero native changes; drives the a11y tree by visible label from the demo-login critical path: `smoke.yaml` + `techhub-shift.yaml` + 4 per-feature flows (academia-setup/study-sets/resume-coach/library-share) + README. iOS-native infrastructure, no row.

**Open decision (recorded, NOT resolved — needs Sam): the "two golds" token.** `lib/theme.ts` `FANG_CURRENCY_GOLD` `#E0A73E` carries an explicit "do not re-point" Round-3 note, but web + `DESIGN.md` §1 mandate Fangs gold `#FFD700` (and the shipped glow surfaces use `#FFD700`). Two golds now answer to "Fangs gold" on iOS. **Deliberately NOT changed this wave — needs Sam's call.** Companion to the 2026-07-04 "two blues".

**Other deferrals (recorded, not done):** share-card image (needs the `react-native-view-shot` dep + a rebuild); AI features Ninny-chat-send + Mastery-study-sheet (need Sam's OpenAI go, cost money); `DailyDrillCard` uses arcade tokens on the calm Study tab (owed a calm pass); low-priority perf nits (`ShiftResults`/Academia/terminal index keys).

**Docs updated:** `lionade-ios/docs/CHANGELOG.md` (2026-07-05 wave-5 bundled entry), `lionade-ios/docs/FEATURES.md` (wave-5 lines: engagement + LionDesk wave 2 ports, the deep-screen DESIGN.md line, the Maestro + shift-perf reliability lines), `IOS_PARITY.md` (new wave-5 header entry with 3 engagement parity rows + the LionDesk/perf/design/Maestro no-row items + the two-golds open decision + the verification-debt banner; the wave-3 TechHub row extended with a dated wave-5 note; the standalone TechHub/LionDesk row flipped from 🚫 web-only to 🟡), vault `Daily/2026-07-05.md` + `Features/Games.md` (LionDesk now 5 tracks) + `Tech-Debt.md` (verification debt, two-golds, the deferrals).

**Context:** fourth batch of the day; stacks on the wave-4 + wave-3 + design-system batches below. Build 27 shipped to TestFlight 2026-07-03; build 28 stays PREPPED pending Sam's go; whether this wave rides build 28 or a later build is an integration-time decision.

---

## 2026-07-05 (third batch) - Web-to-iOS parity wave 4: P1 helpdesk web bug RESOLVED (re-vendored) + LionDesk phase 2 shift sim reaches iOS (helpdesk track, phone-first) (committed, NOT pushed; build 28 still PREPPED, pending Sam's go)

**Repo:** `~/Desktop/lionade-ios` (the iOS app, separate repo). **Branch: `feat/ios-web-parity-wave4` — committed, NOT pushed, NOT built, NOT on TestFlight, NOT on `release/testflight-03`.** Batched per the build-on-command standing order. **Build 28 status unchanged: still PREPPED on `release/testflight-03` from the 2026-07-04 Party batch, NOT yet run/submitted, gated on Sam's explicit go.** Three iOS commits + ONE related WEB commit.

**The commits:**
- WEB `18d3455` fix(techhub): repair `requires[]` gates in 3 generated scenarios (P1) — `~/Desktop/lionade`
- iOS `8e91dbe` feat(techhub): vendor the LionDesk engine (phase-2 foundation, zero-API)
- iOS `3e2a9e6` feat(techhub): LionDesk phase-2 shift sim (shift1, phone-first, zero-API)
- iOS `6bfe4a2` fix(techhub): re-vendor repaired scenarios (all 13 gates solvable)

## ✅✅ THE P1 WEB BUG FROM WAVE 3 IS NOW RESOLVED ✅✅

The wave-3 entry below flagged a P1 bug LIVE ON PROD (helpdesk `requires[]` keyed by command aliases -> 8 of 13 scenarios unreachable). **It is FIXED.** Web `18d3455` is a surgical 6-line rewrite of the three broken `requires[]` arrays (`phish-triage`, `null-ref-500`, `default-creds-admin`) from command aliases to step keys, so `doneSteps` satisfies every resolve gate again — all 13 generated scenarios are solvable. iOS `6bfe4a2` re-vendors the repaired `scenarios.generated.json` so iOS mirrors the FIXED content (JSON diffs clean). **The web edit was a DELIBERATE exception to the web-read-only posture — a live critical bug this iOS workstream surfaced, so patching web at the source was the right call (fixing iOS alone would have forked the vendored content and left web broken on prod).** The wave-3 "iOS mirrors the bug verbatim by design until the web fix lands" contract is discharged. The Tech-Debt note + the wave-3 callouts across CHANGELOG/IOS_PARITY are all reconciled to RESOLVED.

**LionDesk phase 2 — the TechHub shift sim reaches iOS (helpdesk track, phone-first):**
- Wave 3 shipped TechHub phase 1 (single-ticket terminal + track ladders) and deferred the LionDesk SHIFT SIM to "later phases, web-only for now." **Phase 2 brings the shift sim to iOS for ONE helpdesk track (`shift1`), playable end to end** — clock in -> work tickets across panels -> resolve -> grade. The wave-3 "shift sim stays web-only" framing is now itself superseded (deliberate phased port).
- **Engine vendored VERBATIM (`8e91dbe`):** `engine.ts` / `scoring.ts` / `types.ts` / `shift1.ts`, `campaignProgress` pointed at `AsyncStorage`. Zero server routes, deterministic, Fangs preview-only — same discipline as the phase-1 engine.
- **Phone-first UI (`3e2a9e6`), NOT the web desktop-OS windowed UX:** a full-takeover shift route (`app/techhub/[track]/shift.tsx`), a reducer host with a pause-on-background TICK loop (SLA clock pauses when the app backgrounds), a pinned SLA/CSAT status strip, a bridge-pressure meter, a bottom in-shift app-switcher dock (distinct electric pill — the phone-first replacement for web's desktop windows), a clock-in briefing, a results grade screen; six desk panels (`ChannelList` Inbox/Tickets/Phone, `WorkView`, `Stockroom`, `KB`, `AD`) + an embedded `MiniTerminal` in `WorkView`; a new `app/techhub/_layout.tsx` that locks back-swipe on the LIVE shift; a "Start your shift" CTA on the phase-1 track screen.
- **DELIBERATE PHASED PORT — deferred to a results/follow-up wave (NOT gaps):** manager debrief, fumble review, quick recall, replay scrubber, the other 3 tracks/shifts (soc/swe/redteam), and the whole meta layer (dailies/shop/exam/leaderboard/achievements/themes).

**🚨 LOUD VERIFICATION CAVEAT — NOT SIM-VERIFIED, NO DEVICE PASS:** `tsc` clean, two review lenses (engine fidelity + RN/UX), ALL findings fixed pre-commit (keyboard-avoidance on the terminals, the back-swipe lock, dead-code removal). **BUT the simulator auth session was lost earlier in the session, so this XL shipped tsc + review-clean with ZERO on-device / on-simulator run — no one has actually played the shift.** **Sam MUST play it before phase 2 is called done: clock in -> work a ticket across the panels -> resolve -> grade.** Deferred engine-review nit to verify on that pass: the status-strip "resolved N / M" denominator may drift from web's live-items count.

**Docs updated:** `lionade-ios/docs/CHANGELOG.md` (2026-07-05 wave-4 bundled entry), `lionade-ios/docs/FEATURES.md` (new wave-4 line + the wave-3 P1 markers reconciled), `IOS_PARITY.md` (new wave-4 header entry + the wave-3 TechHub row extended with the phase-2 note + the P1 callout flipped to RESOLVED), vault `Daily/2026-07-05.md` + `Features/Games.md` (LionDesk now cross-platform phase 1+2) + `Tech-Debt.md` (P1 -> checked resolved; results-wave-2 deferrals + not-sim-verified flag added).

**Context:** third batch of the day; stacks on the wave-3 + design-system batches below. Build 27 shipped to TestFlight 2026-07-03; build 28 stays PREPPED pending Sam's go; whether this wave rides build 28 or a later build is an integration-time decision.

---

## 2026-07-05 (second batch) - Web-to-iOS parity wave 3: Academia onboarding + Study Sets edit/publish + Library share-link + Resume Coach + Word Bank manage + TechHub phase 1 (committed, NOT pushed; build 28 still PREPPED, pending Sam's go) — P1 WEB BUG (RESOLVED SAME-DAY BY WAVE 4, SEE ABOVE)

**Repo:** `~/Desktop/lionade-ios` (the iOS app, separate repo). **Branch: `feat/ios-web-parity-wave3` — committed, NOT pushed, NOT built, NOT on TestFlight, NOT on `release/testflight-03`.** Batched per the build-on-command standing order. **Build 28 status unchanged: still PREPPED on `release/testflight-03` from the 2026-07-04 Party batch, NOT yet run/submitted, gated on Sam's explicit go.** These ARE web-feature ports (unlike the design-system batch below): six real parity rows in `IOS_PARITY.md`. This wave executed the parity INVENTORY ticket queued in the entry below — the full 8-feature inventory ran first.

**The 7 commits:**
1. `1a435ae` feat(academia): native onboarding funnel + soft tab gate + GPA snapshot states
2. `1f84b10` feat(study-sets): post-save editing + Community Library publishing
3. `b679bc1` feat(library): share-link deep link pins the shared set
4. `0f8c1b6` feat(coach): wire Resume Coach to the live Pro-gated API + un-orphan it
5. `401158c` feat(vocab): per-bank manage panel in the bank switcher
6. `bfd0794` feat(techhub): vendor the helpdesk engine (phase 1, zero-API)
7. `4702071` feat(techhub): phase-1 screens - hub, track ladders, terminal (TRK 001-005)

## ✅✅ P1 WEB BUG — WAS LIVE ON PROD getlionade.com — RESOLVED SAME-DAY BY WAVE 4 (SEE THE THIRD-BATCH ENTRY ABOVE) ✅✅

**Found during the TechHub engine vendoring:** `~/Desktop/lionade/lib/helpdesk/scenarios.generated.json` had **3 scenarios (`phish-triage`, `null-ref-500`, `default-creds-admin`) whose `requires[]` arrays were keyed by command ALIASES, while `doneSteps` only ever receives step values — so their resolve gates could NEVER pass.** Blast radius: **8 of the 13 generated scenarios were unreachable.** The SOC and SWE ladders stranded at ticket 1; redteam stranded after ticket 1. This shipped in the 2026-06-29 TechHub sprint.

**✅ RESOLVED same-day (wave 4):** web `18d3455` rewrote the three `requires[]` arrays to step keys (surgical 6-line fix, all 13 scenarios solvable), then iOS `6bfe4a2` re-vendored the repaired JSON (diffs clean — one web fix healed both platforms). The web edit was a DELIBERATE exception to web-read-only because it was a live critical bug this workstream surfaced. iOS now mirrors the FIXED content; the "iOS mirrors the bug verbatim by design until the web fix lands" contract is discharged. Reconciled in `IOS_PARITY.md` (wave-3 + wave-4 entries), `lionade-ios/docs/CHANGELOG.md` (2026-07-05 wave-3 + wave-4), and the vault `Tech-Debt` note (checkbox closed).

**Inventory outcome (ran before the ports):**
- Review Hub + Word Banks core: confirmed COMPLETE, no drift. On Word Banks IA the drift runs the OTHER way — web follows iOS via the unmerged web branch `feat/web-vocab-ia`.
- Learn-hub level/week stat cells: deliberately SKIPPED — porting them would reverse the documented CEO calm decision on the Study tab. OPEN QUESTION for Sam.
- Library tipping: deliberately SKIPPED — App Store 3.1.1 policy call for Sam; the iOS wiring is S-sized once approved.

**What shipped:**
- **Academia onboarding (`1a435ae`):** native setup funnel for fresh accounts + a SOFT gate routing un-set-up users into setup + honest GPA-snapshot states.
- **Study Sets (`1f84b10`):** post-save editing + Community Library publishing — closes BOTH deliberate v1 cuts from the 2026-07-03 wave-1 port.
- **Library (`b679bc1`):** a shared-set web link now deep-links into the iOS Library with the shared set pinned.
- **Resume Coach (`0f8c1b6`):** wired to the live Pro-gated API + un-orphaned (real entry tile). **AI-COST FLAG:** enables the existing OpenAI gpt-4o-mini endpoints from iOS — server-side Pro gate, only paying users can trigger spend; no new endpoints or spend class.
- **Word Banks (`401158c`):** per-bank manage panel inside the BankSwitcherSheet (the one real Word Banks gap the inventory found).
- **TechHub phase 1 (`bfd0794` + `4702071`):** web helpdesk engine vendored (zero-API, Fangs preview-only) + hub / track-ladder / terminal screens as an Arcade-family surface (entry: 4th calm ModeCard on Games). **Deliberate accent divergence: SWE track `#F59E0B` on iOS vs web `#FFD700` — gold is currency-only law on iOS.** Phase-1 scope: single-ticket terminal + ladders; LionDesk shift sim + dailies/shop/exam etc. are LATER phases. Supersedes the 2026-06-29 "web-only by design" decision (dated note added there).

**⚠️ VERIFICATION CAVEAT:** `tsc` + `eslint` clean throughout; three review lenses (API contracts vs actual web routes / RN correctness / design + copy) + two TechHub lenses (engine fidelity / RN + UX), ALL findings fixed pre-commit. **BUT the simulator auth session was lost mid-wave, so the usual screenshot pass did NOT happen for wave 3.** Sam: sign in and eyeball (1) the Academia setup hero on a fresh account, (2) Study Sets edit/publish, (3) the Resume Coach tile + flow, (4) TechHub hub -> track -> terminal.

**Docs updated:** `lionade-ios/docs/CHANGELOG.md` (2026-07-05 wave-3 bundled entry), `lionade-ios/docs/FEATURES.md` (new "Web-to-iOS Parity Ports" section, 6 lines), `IOS_PARITY.md` (2026-07-05 wave-3 entry with SIX real parity rows + the P1 bug callout + dated supersede notes on the 2026-06-29 TechHub no-row decision and the design-system entry's inventory-queue paragraph), vault `Daily/2026-07-05.md` + `Features/Games.md` + `Features/Resume-Coach.md` + `10-Projects/Lionade-iOS.md` + `Tech-Debt.md` (the P1 bug).

**Context:** stacks on the same-day design-system batch below. Build 27 shipped to TestFlight 2026-07-03; build 28 stays PREPPED pending Sam's go; whether this wave rides build 28 or a later build is an integration-time decision.

---

## 2026-07-05 - iOS design-system codification: DESIGN.md is now law + the 4 tab roots aligned to it (glow stats, eyebrows, two-tier empties) (committed, NOT pushed; build 28 still PREPPED, pending Sam's go)

**Repo:** `~/Desktop/lionade-ios` (the iOS app, separate repo). **Branch: `feat/ios-design-system-alignment` — committed, NOT pushed, NOT built, NOT on TestFlight.** Batched per the build-on-command standing order. **Build 28 status unchanged: still PREPPED on `release/testflight-03` from the 2026-07-04 Party batch, NOT yet run/submitted, gated on Sam's explicit go — and this new branch is NOT yet integrated on `release/testflight-03`, so whether it rides build 28 or the next build is decided at integration time.** No web code changed (web is the SOURCE of everything codified).

**The 2 commits:**
1. `2b6cca8` docs(design): codify the web design system in DESIGN.md + make it law
2. `a76b087` feat(design): apply DESIGN.md to the tab roots (glow stats, eyebrows, empties)

**What shipped:**
- **`DESIGN.md` (new, iOS repo root):** the web design system extracted with exact values + file:line evidence — §0 token map (DM Mono / Bebas Neue mapped to JetBrainsMono / `DisplayText`), §1 the CircleStat three-layer glow recipe, §2 the eyebrow + headline pattern, §3 the user-chosen 8-swatch class palette, §4 the two-tier empty-state pattern + copy voice, §5 the 40px card-density rhythm. iOS `CLAUDE.md` now opens with the rule that makes it LAW: read DESIGN.md before ANY UI work; extend it before implementing undocumented patterns.
- **Applied to the 4 tab roots (restyle-only, no data/handler/nav change):** glow stat treatment on the Study stat strip + You stat row (Fangs gold `#FFD700` / streak `#E67E22` / badges `#9B59B6`, three-layer recipe, no orbiting dot on iOS); mono eyebrows on all four tabs ("lionade · studying pays" / "game night" / "your people" / "this is you", Party pattern, calm Inter headlines stay Inter); `EmptyState.tsx` rebuilt to the two-tier spec + a copy pass across leaderboard/social/academia/vocab/`RecentActivityCard`; new shared `lib/glow.ts` (glow recipe + `usePopOnIncrease`) consumed by `CalmStat` + both glow surfaces.

**Open design item (recorded, NOT resolved):** DESIGN.md §1 mandates `#FFD700` for the Fangs stat glow (per web), but `lib/theme.ts` `FANG_CURRENCY_GOLD` is `#E0A73E` — the token and DESIGN.md need reconciling by `ios-design-hig` (companion to the 2026-07-04 "two blues"). Logged as an open question on the vault `Design-System` note.

**Queued behind the build (per Sam's gate):** a web-to-iOS parity INVENTORY ticket — Academia / Learn / TechHub / Review Hub / Study Sets / Library / Word Banks / Resume. Inventory only, no port work started.

**Gates:** `tsc` clean -> `ios-code-reviewer` (minor-issues; all findings fixed pre-commit) -> `ios-docs-writer`. Before/after sim verification on all 4 tabs. Docs updated: `lionade-ios/docs/CHANGELOG.md` (2026-07-05 bundled entry), `lionade-ios/docs/FEATURES.md` (2 Design System lines), `IOS_PARITY.md` (2026-07-05 deliberate-no-row-style entry — web is the source, no port-back), vault `Daily/2026-07-05.md` + `Design-System` note (DESIGN.md milestone + the Fangs-gold open question).

**Context:** build 27 shipped to TestFlight 2026-07-03; the 2026-07-04 Party batch (build 28) is PREPPED and still waiting on Sam's go. This branch stacks the next batch behind it.

---

## 2026-07-04 - iOS Party polish batch: crash fix + typography system + Arcade visual language + realtime hardening + 2nd wave (theme tokens + game-view audit + clip-safety completion) + 3rd wave (shared realtime helper + leg-3 + Arcade game-screen tokens) (HELD for TestFlight build 28 — PREPPED, pending Sam's go)

**Repo:** `~/Desktop/lionade-ios` (the iOS app, separate repo). **Status: committed, NOT pushed, NOT built, NOT on TestFlight.** Batched for **TestFlight build 28** per the build-on-command standing order; the full batch is now also integrated on `release/testflight-03`. **Build 28 is PREPPED (`tsc`-clean, reviewed, smoke-tested on `release/testflight-03`) but the EAS build + TestFlight auto-submit are NOT yet run and NOT yet submitted — gated on Sam's explicit go.** This is an iOS-native quality/visual batch, NOT a web-feature port; no web code changed.

**Branch stack (stacked, in order, current = last):**
`fix/ios-party-create-crash` -> `fix/ios-party-typography` -> `feat/ios-party-visual-parity` -> `feat/ios-party-arcade-polish` (3rd wave landed here; whole batch also on `release/testflight-03`)

**The ~14 commits (newest last) — items 9-10 + one no-commit audit are the second wave; items 11-12 are the third wave:**
1. `ca2a7b0` fix(party): stop the room-create crash from a realtime channel-reuse race
2. `b3048e0` fix(type): stop BebasNeue display-serif glyph clipping app-wide
3. `bc8b061` fix(type): move the leaked `includeFontPadding` back into the style object
4. `a1bb967` feat(party): re-skin the Lionade Party hub into the Pardy Arcade family
5. `afccd1b` fix(party): close code-reviewer nits (room-shell clipping + dead ref)
6. `1f43ab1` feat(party): extend the Arcade electric re-skin into lobby + in-game chrome
7. `2d26a5a` feat(type): add the shared `DisplayText` component + migrate the fixed hero titles
8. `20a7ca6` fix(realtime): harden focus-room + messages against the same channel-reuse race
9. `414279a` refactor(theme): centralize the Arcade electric + ticket tokens in `lib/theme.ts`
10. `a213193` fix(type): make BebasNeue clip-safety complete + provable app-wide
    - **(no commit)** game-view realtime audit: all 6 Party game-view channels (`RoomLobby`, `Trivia`, `Bluff`, `Sketch`, `SketchCanvas`, `PokerFace`) audited + cleared — a clean audit, no code change
11. `09705b1` refactor(realtime): shared `attachAndSubscribe` guard (`lib/realtime-channel.ts`) + close leg-3 on the game views
12. `28cddbd` refactor(theme): migrate the Arcade game screens (pardy, arcade hub, blitz) to the shared `arcade` tokens

**What shipped:**
- **Crash fix:** Party "Create Room" crashed the app (supabase-js channel reuse -> `.on()` after `subscribe()` throws). Fixed by splitting the `use-party-room` realtime effects + a fresh-channel guard + a `PartyErrorBoundary` + a user-facing recovery toast.
- **Typography:** BebasNeue display-glyph clipping fixed app-wide (169 inline sites / 68 files: `lineHeight -> round(fontSize * 1.2)` + `includeFontPadding: false`). A single-line-inline insertion bug (`includeFontPadding` leaking as a JSX text child on 8 sites) was caught and fixed. New `components/DisplayText.tsx` is the one true BebasNeue title wrapper (28 hero sites migrated) so the fix can't regress.
- **Visual parity:** the Party hub + lobby + in-game chrome re-skinned into the Pardy "Arcade ticket" family (electric `#4A90D9`, matte `#0C111B` ticket cards, mono eyebrow + BebasNeue hero); chrome purple -> electric while preserving each game's identity color (Lightning orange, Sketchy purple, Bluff/gold).
- **Realtime hardening:** audited all realtime hooks for the same crash class; fixed `use-focus-room` (HIGH, same latent race) + `use-messages` (LOW, AppState symmetry).
- **Second wave (same held branch, closes both first-wave follow-ups):**
  - **Arcade theme-token extraction (`414279a`):** added an `arcade` token group to `lib/theme.ts` (electric `#4A90D9` + wash/border/tile/light + ticket-card body/hairlines), kept distinct from `calm.accent` `#33B1FF` (main-app accent), and migrated the 6 Party chrome files off per-file local `ELECTRIC`/`ACCENT` consts. Byte-for-byte identical rendering — pure centralization.
  - **Game-view realtime audit (no commit):** all 6 Party game-view channels (`RoomLobby`, `Trivia`, `Bluff`, `Sketch`, `SketchCanvas`, `PokerFace`) audited vs the three-leg test — ALL SAFE (each breaks leg 2: round/phase/roundId in refs, never in effect deps, so no stable-topic channel is recreated mid-life). Clean audit, no code change.
  - **Clip-safety completion (`a213193`):** a codemod pinned `includeFontPadding: false` + explicit `lineHeight = round(fontSize*1.2)` on the 353 no-`lineHeight` BebasNeue sites (96 files) the `b3048e0` threshold missed (incl. `CountUp`/`Animated` hosts). Now 0 no-`lineHeight` and 0 clip-tight sites repo-wide — "0 clipping sites" is literally/provably true. Completes clip-SAFETY via codemod, NOT a full `DisplayText` migration (`DisplayText` stays the standard for NEW titles).
- **Third wave (same held branch, also on `release/testflight-03`; closes the 2nd wave's last optional item + surfaces a new design question):**
  - **Shared realtime helper + leg-3 (`09705b1`):** extracted the duplicated `attachAndSubscribe` fresh-channel guard (copy-pasted in `use-party-room` + `use-focus-room`) into ONE shared `lib/realtime-channel.ts` both hooks now import (byte-for-byte identical; warn tag collapses to a generic `[realtime]`). Then ADOPTED that guard in the 5 Party game views (`TriviaView`, `BluffView`, `SketchView`, `SketchCanvas`, `PokerFaceView`) as defense-in-depth "leg 3" — already safe via leg 2, but their safety no longer depends on leg 2 staying broken across future edits. Zero game-handler-semantic change; two clean `ios-code-reviewer` passes (nits only). CAVEAT: multi-client live game sync could NOT be verified in a single simulator — the guard's byte-for-byte transparency + the two reviews are the assurance.
  - **Arcade game-screen token migration (`28cddbd`):** migrated the 3 genuine Arcade GAME screens (pardy, arcade hub, blitz) to `import { arcade } from lib/theme`, extending the 2nd-wave `414279a` extraction so the token group is the single source of truth for the games layer too. Byte-for-byte identical. `roardle` correctly SKIPPED (uses `calm.accent` `#33B1FF`, not the Arcade electric `#4A90D9`).

**FOLLOW-UP STATUS (2nd wave closed both first-wave items; 3rd wave closed the 2nd wave's last optional item except the rematch wart):**
1. **RESOLVED — BebasNeue clip-safety / "0 tight sites literally true":** closed by `a213193` (codemod on the 353 no-`lineHeight` sites). NOTE the distinction: resolved via codemod making existing sites safe in place, NOT via a full `DisplayText` migration.
2. **RESOLVED — audit the Party per-game view realtime channels:** closed clean — all 6 game-view channels audited and cleared (all safe, no code change needed).
3. **RESOLVED (3rd wave) — the optional leg-3 defense-in-depth on the game-view channels:** closed by `09705b1` (shared `lib/realtime-channel.ts` guard adopted across the 5 game views). NOT closed: the minor rematch throwaway-channel wart (see below).

**What remains open after the 3rd wave:**
- **[LOW, open] The minor rematch throwaway-channel wart** — DELIBERATELY skipped to avoid churning timing-sensitive live-multiplayer code for no correctness gain.
- **[DESIGN QUESTION for Sam, open — NOT a bug]** The "two blues" design-token inconsistency, found during the 3rd-wave `28cddbd` migration: the Arcade electric `#4A90D9` also appears in ~70 NON-Arcade files as a generic blue accent alongside `calm.accent` `#33B1FF` (which blue is canonical where). The two-accents-on-purpose separation the tokens encode is intentional; the open question is only the ~70 generic-blue `#4A90D9` uses outside the Arcade context. A DESIGN DECISION for Sam, deliberately left un-touched rather than mechanically find-and-replaced. Logged to the vault `Design-System` note.

**Gates:** `ios-qa-tester` -> `ios-code-reviewer` (batch nits closed in `afccd1b`; two clean passes over the 3rd-wave `09705b1` realtime refactor) -> `ios-docs-writer`. Verified locally (incl. sim-verify of the clip-safety codemod on Study/Pardy + confirmation both `arcade` token migrations render byte-for-byte identically); multi-client live game sync unverified in a single simulator (guard transparency + reviews are the assurance); on-device confirm rides build 28. Docs updated for ALL THREE waves: `lionade-ios/docs/CHANGELOG.md` (2026-07-04 bundled entry, now with Second-wave + Third-wave subsections + Resolved-follow-ups + the two-blues open question), `lionade-ios/docs/FEATURES.md` (Design System/Typography + Platform/Reliability lines + the Arcade-theme-tokens line extended to the game screens + the two-blues question), `IOS_PARITY.md` (2026-07-04 iOS-native batch, +2 more rows = +4 total for the batch, leg-3 marked RESOLVED, two-blues open question logged), vault `Daily/2026-07-04.md` + `Design-System` + `Tech-Debt`.

**Context:** build 27 shipped to TestFlight 2026-07-03 (previous entry / `project_build22_pending` memory). This build-28 batch is the next one in line — PREPPED on `release/testflight-03` but NOT yet run/submitted, pending Sam's explicit go. Still local.

---

## 2026-06-29 - TechHub/LionDesk 40-feature sprint SHIPPED TO MAIN (live)

**Branch:** `feat/techhub-liondesk`, also pushed to `main` (= live getlionade.com). Main tip `4033bb7` (features), then this docs commit on top. 78+ commits ahead of the pre-sprint base `889e82a`.

**What shipped this session: 40 TechHub features in 8 batches**, each built then adversarially reviewed then auto-fixed via the Workflow tool, in small per-feature commits:
1. Today's Board, quick-recall, SOC/SWE/RedTeam content, content validator, streak milestones.
2. Concept mastery + Weak Spots, career saga + promotions, scoring single-source-of-truth, difficulty-weighted payouts, Major Incident boss-shift + Bridge Pressure meter.
3. Vitest harness + golden engine tests, accessibility pass, behavior mutators, shareable seeds, real-world skill mapping.
4. Gated leaderboard, NetOps track, stats dashboard, quests, ambient sound.
5. Wiring pass (plus the SLA-breach engine fix), onboarding coach marks, manager 1:1s, economy balance, in-desk settings popover.
6. Share-result card, seasonal shifts, adaptive difficulty, beat-my-desk links, desk ambiance.
7. Leaderboard scoring + season archive, certification exam, classroom challenge, KB browser.
8. Replay scrubber, per-track mastery, route code-split, track shift-2s, placement test, command palette.
Plus compliance: removed user-facing em-dashes, and `downlevelIteration: true` in tsconfig (the prod typecheck rejects Set spreads at the default low target).

**VERIFY FIRST:** Node is absent in the Claude sandbox, so NONE of this was locally typechecked/built. The Vercel build is the only gate. Confirm the latest `main` Vercel build is GREEN before trusting it; if red, the error names the file and we fix-forward (a failed build keeps the last good prod deploy live).

**Held migrations (NOT applied, features degrade to preview):** `20260626120000` shift-completions, `20260628120000` techhub_leaderboard. Fangs stay preview-only and the leaderboard shows "goes live soon" until applied.

**Cadence going forward:** build TechHub in batches of ~3 (down from 5).

**On the bench (designed, not built):** Ninny AI tutor (needs go, real API cost), cosmetic Fang-sink shop, daily-recap email via Resend, deeper screen-reader audit, NetOps shift 3-5.

---

## 2026-06-28 - Security projects track (after the TechHub/LionDesk sprint)

**Branch:** `feat/techhub-liondesk` (42+ commits ahead of `main`, NOT merged, NOT deployed).

**To continue on the new machine:**
1. `git fetch origin && git checkout feat/techhub-liondesk && git pull`
2. Recreate **`.env.local`** - it is gitignored and does NOT transfer. Copy it over from this machine or your password manager (it holds the Supabase, Stripe, Resend, and other keys). Without it the app and the Resend test scripts will not run.
3. `npm install`, then `npm run dev`.
4. Verify the pull: `git log --oneline -10` should show the security commits below, newest being the NIST CSF assessment.

**What was done most recently (newest first):**
1. **Security project #13 - NIST CSF 2.0 gap assessment.** `docs/security/nist-csf-2.0-gap-assessment.md`. Evidence-cited, 6 functions: Protect = Strong, Govern/Identify/Detect/Respond = Partial, Recover = Gap. 2 P0 + 13 P1 gaps, 3-wave remediation roadmap. Verified against the live repo; corrected npm audit to the real 18 vulns / 10 high.
2. **Security project #20 - Vulnerability Disclosure Policy.** `/.well-known/security.txt` (RFC 9116), `/security` page, `SECURITY.md`, `SECURITY_EMAIL` in `lib/site-config.ts`. Code + legal reviewed. Working draft pending a real lawyer.
3. **Email infrastructure** for getlionade.com via Cloudflare Email Routing -> one inbox. WARNING, still broken: the Outlook destination (`getlionade@outlook.com`) never verified ("Destination address not found") and bounces all mail. A Gmail destination works (the `hello@` rule delivers to a Gmail). FIX NEEDED: make/verify a Gmail destination (e.g. `getlionade@gmail.com`), repoint the `security`/`support`/`abuse`/`privacy`/`partnerships`/`press` rules to it, delete the dead Outlook destination, then test `security@getlionade.com`. Until then those addresses bounce.
4. **Repo cleanup:** removed 14 stray root screenshots, pruned stale git worktrees.
5. **Earlier this session:** the large TechHub / LionDesk game build sprint (stockroom supply-chain with vendor lead times, phone-call patience meter, in-shift lifelines, Easy/Normal/Hard difficulty, resolve streaks, manager debrief, coworker chatter, the full SOC/SWE/RedTeam shift 3-5 ladder, new achievements + theme, play streak, sound cues). All at `/learn/techhub`.

**Pending / next:**
- Finish the email setup (the Gmail-destination fix above). The VDP from #20 is fully wired only once `security@` delivers.
- **Held migrations, NOT applied** (Fangs stay preview-only until applied): `lib/migrations/20260626120000_techhub_shift_completions.sql` and the other held economy/admin migrations noted in earlier commits.
- **Next security project options:** Dependabot + a CI `npm audit` gate and clear the 10 high CVEs (recommended easy win, closes a gap the assessment found), IR playbook + breach-notification runbook (#17, both P0 gaps), CSPM/Prowler on the AWS footprint (#11), least-privilege IAM review (#12), LLM/prompt-injection red-team of Ninny (#8, flagged API cost).
- Nothing is merged to `main` or deployed. All work lives on `feat/techhub-liondesk`.

**Constraints still in effect:** currency is "Fangs" (never coins/points), no em-dashes or en-dashes in user-facing copy, economy is server-authoritative (never grant Fangs client-side), migrations stay held until explicit go, do not push/merge to main or deploy without explicit instruction.
