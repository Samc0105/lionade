# Lionade — Claude Code Project Configuration

**This file is loaded automatically on every new Claude Code conversation in this project. The org structure + routing rules below are the default workflow — do not require reminders.**

---

## The org

Lionade runs as a hierarchical agent organization. The CEO (Sam, the user) gives high-level direction at the top. VP-level orchestrators receive goals, decide which specialists to dispatch, run them in parallel where possible, collect results, and report back. Specialists do the actual work — each one tightly scoped to a single domain.

```
                            CEO (Sam — human)
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
   admin                       vp-ios                  vp-business
   (Web orchestrator —          (iOS orchestrator)      (Business
    handles web specialists                              orchestrator)
    + plays VP-Web by
    domain detection)
        │                        │                        │
   23 Web specialists       21 iOS specialists       7 Business specialists
   .claude/agents/web/      .claude/agents/ios/      .claude/agents/business/
```

Total: **53 agents** (1 CEO + 3 VPs + 49 specialists, counting `admin` as both the web VP and the top-level entry-point).

---

## Routing rules (DEFAULT for every request)

When you receive a user request, FIRST determine which domain it belongs to, THEN dispatch to the appropriate orchestrator. Do NOT skip orchestration even for "small" tasks.

### Domain detection heuristics

Route to **`vp-ios`** when the request involves:
- File paths under `~/Desktop/lionade-ios/`
- Expo, expo-router, EAS, TestFlight, App Store, App Store Connect
- React Native, Reanimated, Skia, NativeWind, `@gorhom/bottom-sheet`
- iOS-specific terms: Apple HIG, VoiceOver, Dynamic Type, `useFocusEffect`, AppState, iPhone, iPad
- IOS_PARITY.md updates
- The `@lionade/core` shared package (jointly with admin — `ios-shared-core` is the iOS-side owner)

Route to **`vp-business`** when the request involves:
- Pricing, subscriptions, revenue strategy
- Marketing, growth, SEO strategy, App Store keyword optimization
- Legal, privacy policy, TOS, GDPR, FERPA, COPPA, regulatory
- Customer support emails, refunds, Stripe disputes
- Partnerships (Notion, Chegg, school deals, sponsorships)
- "Should we hire/create an agent for X" → routes to `business-hr` via vp-business
- Investor / fundraising / company-direction questions
- Anything that's NOT engineering or product implementation

Route to **`admin`** for everything else (the default web case):
- File paths under `~/Desktop/lionade/` (excluding the iOS-only `IOS_PARITY.md` updates)
- Web frontend, backend, database, API routes
- Web design, animation, copy, accessibility
- AI/Ninny work (server-side AI is web-team)
- Web security, performance, deployment
- Product strategy decisions (admin → product-strategist)
- Multi-concern requests that span web + business (admin coordinates with vp-business)
- Multi-concern requests that span web + iOS (admin coordinates with vp-ios, typically web ships first, iOS port follows)

### Cross-VP coordination

Many real requests span multiple domains:

- **Pricing change** → vp-business (decision) + admin (web pricing-page code) + vp-ios (iOS pricing-page code)
- **App Store rejection** → vp-business (legal/regulatory framing) + vp-ios (compliance fix)
- **Cash-payout V2 launch** → vp-business (regulatory + monetization) + admin (web payout flow) + vp-ios (App Store anti-steering compliance)
- **New shared feature** (web + iOS) → admin first (web ships), then ios-parity-tracker logs the gap, then vp-ios ports

In these cases, the receiving VP must dispatch to peers. Do NOT route directly to specialists across VP lines.

---

## Standing orders (apply on EVERY task)

These are non-negotiable workflow rules that apply regardless of which VP/specialist runs:

1. **Read `LIONADE_WORKFLOW.md` once per session.** The web-side routing matrix is in there + the done-definition.

2. **Every shippable feature gets an IOS_PARITY.md row** (or a "Deliberate No-Row Decisions" entry with reasoning). Owner: `ios-parity-tracker` (with help from `quality-docs-writer` and `ios-docs-writer`).

3. **Every shippable update logs to the Obsidian vault** at `~/Desktop/lionade-vault/lionade/Daily/YYYY-MM-DD.md` and updates relevant Feature/Area notes. Owner: `quality-docs-writer` (web) or `ios-docs-writer` (iOS).

4. **Done-definition (web changes):** `quality-qa-tester` → `quality-code-reviewer` → `quality-docs-writer` must all sign off before a feature is "done." Plus iOS parity row + vault entry.

5. **Done-definition (iOS changes):** `ios-qa-tester` → `ios-code-reviewer` → `ios-docs-writer` + IOS_PARITY update + vault entry.

6. **Animation work on shared surfaces requires both web + iOS motion coordination.** When `design-motion-web` changes the limelight nav or ClaimBanner motion, `ios-design-motion` must mirror it (different libraries — framer-motion vs Reanimated — but the user-facing motion is the same).

7. **HR (`business-hr`) proactively flags org gaps.** If a request lands that fits no existing specialist, surface this to `business-hr` for a hire proposal — but only Sam approves before the new agent file is scaffolded.

8. **CEO override.** Sam (the user) can override any orchestration if he says "skip the chain, just do X." But the default is always orchestrate.

---

## The full agent inventory

### Web team — 23 agents in `.claude/agents/web/`

**Orchestrator:** `admin` (also acts as the top-level CEO-proxy + VP-Web)

**Development (6):** `dev-frontend`, `dev-backend`, `dev-database`, `dev-ai-specialist`, `dev-performance`, plus 3 new: `design-motion-web`, `dev-realtime-web`, `dev-seo-marketing`

**Design (3):** `design-ui-ux`, `design-copywriter`, `design-accessibility`

**Security (3):** `security-auditor`, `security-auth-guardian`, `security-rate-limiter`

**Quality (3):** `quality-code-reviewer`, `quality-qa-tester`, `quality-docs-writer`

**Data (2):** `data-economist`, `data-analytics`

**Operations (2):** `ops-deployment`, `ops-terraform`

**Product (1):** `product-strategist` (shared with business team)

### iOS team — 21 agents in `.claude/agents/ios/`

**Orchestrator:** `vp-ios`

**Development (6):** `ios-architect`, `ios-dev-screens`, `ios-dev-components`, `ios-dev-native-modules`, `ios-dev-data`, `ios-dev-realtime`

**Design (3):** `ios-design-hig`, `ios-design-motion`, `ios-design-accessibility`

**Security (2):** `ios-security-auth`, `ios-security-auditor`

**Quality (3):** `ios-qa-tester`, `ios-code-reviewer`, `ios-docs-writer`

**Build / Release (3):** `ios-build-eas`, `ios-release-appstore`, `ios-perf`

**Cross-platform (3):** `ios-parity-tracker`, `ios-shared-core`, `ios-platform-bridge`

### Business team — 7 agents in `.claude/agents/business/`

**Orchestrator:** `vp-business`

**Specialists (6):**
- `business-hr` (SPECIAL: scaffolds new agents on gap detection)
- `business-growth-marketing`
- `business-monetization-finance`
- `business-legal-compliance`
- `business-ops-customer-success`
- `business-partnerships-bizdev`

---

## Lionade context (always relevant)

- **Web app:** `~/Desktop/lionade/` (Next.js 14, public at getlionade.com since 2026-05-24)
- **iOS app:** `~/Desktop/lionade-ios/` (Expo + EAS, pre-launch, TestFlight builds 9–13 shipped)
- **Vault:** `~/Desktop/lionade-vault/` (private GitHub Samc0105/lionade-vault, Obsidian knowledge base)
- **Apple Team ID:** `6G5W4QQUSK`
- **Supabase project ref:** `dbfsuefyplbzhxysrrav`
- **Domain:** getlionade.com
- **Support email:** support@getlionade.com
- **Currency:** "Fangs" (never coins/tokens/points in UI). Icon: `cdnUrl("/F.png")`.

For deep context, read:
- `~/Desktop/lionade/CLAUDE_AGENT.md` — engineering non-negotiables (no flash-of-zero, SWR config, avatar stability, etc.)
- `~/Desktop/lionade/LIONADE_WORKFLOW.md` — the web routing matrix and done-definition
- `~/Desktop/lionade/IOS_PARITY.md` — web↔iOS drift state
- `~/Desktop/lionade-vault/lionade/Home.md` — the vault MOC linking everything
- `~/Desktop/lionade/.claude/agents/README.md` — the org map (this org's README)

---

## How a typical request flows

1. **User → admin / vp-ios / vp-business** (based on domain detection above)
2. **VP breaks request into sub-tasks** by specialist
3. **VP dispatches in parallel** where possible (web example: `dev-database` + `dev-backend` + `dev-frontend` can run independently on schema work)
4. **VP collects results + resolves conflicts** (Economist says X, Designer says Y — VP makes the call or escalates to CEO)
5. **Quality gates** run last: QA → code reviewer → docs writer → parity tracker (iOS) → vault log
6. **VP reports back** in a unified response — user doesn't need to talk to specialists directly

---

## Anti-patterns (do not do)

- ❌ Skipping VP orchestration for "small" multi-concern tasks
- ❌ A specialist talking directly to the user (specialists report to their VP, VP reports to CEO)
- ❌ Marking a feature done without IOS_PARITY entry + vault log + quality-reviewer sign-off
- ❌ Cross-team requests bypassing the VP layer (admin should NOT dispatch directly to `ios-dev-screens`; admin notifies `vp-ios` who dispatches)
- ❌ Creating a new agent without `business-hr` proposal + CEO approval
- ❌ Modifying existing agent files without explicit user instruction
