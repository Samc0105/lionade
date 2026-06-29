# Worklog - cross-machine session handoff log

This is the handoff note between machines. When you pull on another computer and ask Claude **"what was the last thing I did,"** this file is the answer (Claude is pointed here from CLAUDE.md). Newest entry first. If you can read the entry below on a freshly pulled machine, the pull worked.

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
