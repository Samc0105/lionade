# LIONADE_WORKFLOW.md — Standing Orders for Every Prompt

**This file MUST be read before responding to any non-trivial request.**
**The UserPromptSubmit hook injects a reminder to read this file. Do not skip it.**

---

## The Three Laws

1. **Route via `admin` agent** for any request involving more than one concern (UI + backend, schema + API, feature work, etc.). `admin` reads this file, fans out to the right specialists from the matrix below, collects results, and reports back.
2. **Every web feature ships to iOS.** A feature is not "done" until it has a row in `IOS_PARITY.md` and a corresponding iOS task is captured. iOS app lives at `~/Desktop/lionade-ios` (Expo + EAS).
3. **Use the agent matrix.** Specialized agents exist for a reason. If a request fits a specialist, the specialist runs — not the generalist.

---

## Agent Routing Matrix

The `admin` agent uses this table to decide who runs what. Order matters — agents earlier in a row produce inputs that later agents consume.

| Request type | Agent chain |
|---|---|
| **New feature (full build)** | `product-strategist` → `design-ui-ux` → `design-copywriter` → `dev-database` → `dev-backend` → `dev-frontend` → `security-auth-guardian` → `security-rate-limiter` → `design-accessibility` → `quality-qa-tester` → `quality-code-reviewer` → `quality-docs-writer` → **append iOS row to `IOS_PARITY.md`** |
| **AI / Ninny work** | `dev-ai-specialist` → (`data-economist` if Fangs involved) → `dev-backend` → `quality-code-reviewer` |
| **Schema / migration** | `dev-database` → `dev-backend` → `security-auditor` → `quality-docs-writer` |
| **UI tweak / visual polish** | `design-ui-ux` → `dev-frontend` → `design-accessibility` |
| **Copy / text change** | `design-copywriter` → `dev-frontend` |
| **Bug fix** | `dev-{layer}` → `quality-qa-tester` → `quality-code-reviewer` |
| **Performance work** | `dev-performance` → `dev-{layer}` |
| **Pre-deploy / release** | `security-auditor` → `quality-qa-tester` → `ops-deployment` |
| **Infra / IaC** | `ops-terraform` → `ops-deployment` |
| **Economy / Fangs change** | `data-economist` → `data-analytics` → `dev-backend` |
| **Analytics / metrics** | `data-analytics` → `quality-docs-writer` |
| **Auth / RLS change** | `security-auth-guardian` → `dev-database` → `security-auditor` |
| **Rate limit change** | `security-rate-limiter` → `dev-backend` |
| **After EVERY shippable change** | `quality-code-reviewer` + `quality-docs-writer` (CHANGELOG + FEATURES) + iOS parity entry |

If a request doesn't fit a row, `admin` picks the closest match and documents why.

---

## Done-Definition

A feature is "done" only when ALL of these are true:

- [ ] Web implementation passes type-check + lint
- [ ] `quality-qa-tester` has signed off on the happy path + at least 2 edge cases
- [ ] `quality-code-reviewer` has reviewed
- [ ] `quality-docs-writer` has updated `docs/CHANGELOG.md` and `docs/FEATURES.md`
- [ ] **iOS parity row added to `IOS_PARITY.md`** (status `❌ pending` is acceptable — what matters is it's tracked)
- [ ] `design-accessibility` checked (if UI involved)
- [ ] `security-auth-guardian` checked (if API/data involved)
- [ ] Self-check list in `docs/CLAUDE_AGENT.md` passes

Half-done features get a partial-status entry in `IOS_PARITY.md`, not a "skip iOS" pass.

---

## iOS Parity Strategy

**Current approach: Strategy B — weekly catch-up.**

- Web ships freely with `IOS_PARITY.md` rows added per feature.
- iOS port happens in batches (typically Friday sync session or when a parity item blocks an iOS user flow).
- Long-term goal: **Strategy C** — refactor shared business logic into a shared TS package both consume. Trigger when 5+ features have drifted for 2+ weeks.

iOS app reference:
- Repo: `~/Desktop/lionade-ios`
- Stack: Expo + EAS, NativeWind (Tailwind), expo-router
- Apple Team ID: `6G5W4QQUSK`

---

## Anti-Patterns (do not do)

- ❌ Skipping `admin` to "save time" on multi-concern requests
- ❌ Marking a feature done without an `IOS_PARITY.md` entry
- ❌ Using `general-purpose` agent when a specialist exists
- ❌ Skipping `quality-code-reviewer` because "it's just a small change"
- ❌ Touching files in `docs/CLAUDE_AGENT.md`'s "Do Not Touch" list without explicit user instruction
- ❌ Adding features that violate the Fangs economy without `data-economist` review
- ❌ Adding new SQL tables without RLS (see `docs/CLAUDE_AGENT.md` § Database Changes)

---

## Quick-Reference: All Available Agents

**Orchestration:** `admin`
**Product:** `product-strategist`
**Design:** `design-ui-ux`, `design-copywriter`, `design-accessibility`
**Engineering:** `dev-frontend`, `dev-backend`, `dev-database`, `dev-ai-specialist`, `dev-performance`
**Security:** `security-auditor`, `security-auth-guardian`, `security-rate-limiter`
**Quality:** `quality-code-reviewer`, `quality-qa-tester`, `quality-docs-writer`
**Data:** `data-economist`, `data-analytics`
**Ops:** `ops-deployment`, `ops-terraform`
**Utility:** `general-purpose`, `Explore`, `Plan`

---

*Last updated: 2026-05-13. Update this file when the agent roster changes or the parity strategy shifts.*
