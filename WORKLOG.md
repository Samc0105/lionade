# Worklog - cross-machine session handoff log

This is the handoff note between machines. When you pull on another computer and ask Claude **"what was the last thing I did,"** this file is the answer (Claude is pointed here from CLAUDE.md). Newest entry first. If you can read the entry below on a freshly pulled machine, the pull worked.

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
