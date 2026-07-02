# Lionade — Claude Code Project Configuration

**🛑 STOP. Read this file fully before responding to ANY user input. This is non-negotiable.**

This file is the **highest-priority context** for every Claude Code conversation in this project. If you receive a user prompt and have not internalized the rules below, your first action is to read this file. Do not skip. Do not infer the rules — read them.

---

## ⚡ THE THREE LAWS OF EVERY USER PROMPT

These apply to **every single input from the user**, including casual thoughts, half-finished ideas, "what if" musings, and one-line questions. There is no "small enough to skip orchestration" threshold.

### Law 1: Every prompt invokes the agent system.

The moment Sam types something, identify which VP(s) should receive the request and dispatch. Even an open-ended "what should I think about next?" routes to `product-strategist` via `admin`. Even "is this idea dumb?" routes to the relevant specialist. **There is no path where Claude Code responds without consulting the appropriate agent(s) first.** The user has explicitly opted into this workflow — bypassing it betrays the design.

### Law 2: Default scope is CROSS-PLATFORM (web + iOS), not web-only.

When Sam expresses a product thought, feature idea, copy change, motion tweak, pricing experiment, or any change that touches the user-facing product, the **default assumption is that it applies to BOTH the web app AND the iOS app**. This means:

- `admin` (web team) AND `vp-ios` (iOS team) are dispatched in parallel.
- Each VP coordinates their team's portion of the work.
- The work is reconciled into a unified plan + execution.
- `ios-parity-tracker` logs the cross-platform delivery.

**The only exceptions** — and they must be EXPLICIT in the user's prompt:
- "just on web" / "web only" / "for the web app" → admin only, vp-ios stays out
- "just on iOS" / "iOS only" / "for the iOS app" → vp-ios only, admin stays out
- "this is a backend/infra change" → admin only (no iOS counterpart)
- "this is App-Store-specific" → vp-ios only (no web counterpart)
- Business-only thoughts (pricing, legal, marketing strategy without product code) → vp-business

If Sam doesn't say "just web" or "just iOS," **assume both.** Web-only-by-default is wrong. The session is web-first because that's where the dev server runs, but the product is web + iOS.

### Law 3: CLAUDE.md is loaded first, every session, every time.

This file overrides any prior conversation patterns. If you are unsure how to route, the answer is in this file. Do not invent routing — read.

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

When you receive a user request:

1. **Always parse the prompt for explicit platform scope first.** Did Sam say "just web" / "iOS only" / "this is for support emails"? If yes → route to that domain only.
2. **If NO platform was specified, assume CROSS-PLATFORM is the default.** Dispatch admin + vp-ios in parallel for any product/feature/UX change. (See Law 2 above.)
3. **Business-only thoughts** (pricing, marketing, legal, partnerships, customer-success) → vp-business — these don't get cross-platform-doubled because they're not product-code.
4. **NEVER skip orchestration**, even for small tasks. (See Law 1 above.)

### Cross-platform default — concrete examples

Sam says: → You route to:

- "Move the daily-claim button up the dashboard" → admin **AND** vp-ios (both platforms have a dashboard)
- "Change Pro from $6.99 to $7.99" → vp-business **AND** admin **AND** vp-ios (pricing decision + web pricing page + iOS pricing page)
- "The animation on the claim toast feels heavy" → admin (`design-motion-web`) **AND** vp-ios (`ios-design-motion`) — cross-platform motion parity
- "Add a referral mechanic" → vp-business (mechanic design) **AND** admin **AND** vp-ios (implementation on both)
- "Audit our SEO" → admin only (`dev-seo-marketing`) — SEO is web-only by definition; no iOS counterpart
- "TestFlight build is failing" → vp-ios only — iOS-specific by definition
- "Should we email the waitlist?" → vp-business only (`business-growth-marketing` + `business-ops-customer-success`) — no product code
- "What should I build next?" → admin (`product-strategist`) **AND** vp-business — strategy is platform-agnostic
- "Just on web, hide the Daily Bet card" → admin only (explicit "just on web")
- "Only on iOS, add a haptic to the claim button" → vp-ios only (explicit "only on iOS")

### Domain detection heuristics (fine-tuning, when ambiguous)

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
- `~/Desktop/lionade/docs/CLAUDE_AGENT.md` — engineering non-negotiables (no flash-of-zero, SWR config, avatar stability, etc.)
- `~/Desktop/lionade/LIONADE_WORKFLOW.md` — the web routing matrix and done-definition
- `~/Desktop/lionade/IOS_PARITY.md` — web↔iOS drift state
- `~/Desktop/lionade-vault/lionade/Home.md` — the vault MOC linking everything
- `~/Desktop/lionade/.claude/agents/README.md` — the org map (this org's README)
- `~/Desktop/lionade/WORKLOG.md` — the cross-machine session handoff log. **When Sam asks "what was the last thing I did" (especially right after a fresh `git pull` on another computer), read this first**, then confirm against `git log --oneline -10`.

---

## How a typical request flows

1. **User input arrives.** First action: parse for explicit platform scope ("just web," "iOS only," etc.).
2. **Determine routing.** If no scope specified → cross-platform default → admin + vp-ios in parallel (plus vp-business if business-side).
3. **Each VP breaks their portion into sub-tasks** by specialist.
4. **VPs dispatch in parallel** where possible (web example: `dev-database` + `dev-backend` + `dev-frontend` can run independently on schema work).
5. **VPs collect results + resolve conflicts** within their team. Cross-VP conflicts escalate to CEO (Sam).
6. **Quality gates** run last: QA → code reviewer → docs writer → parity tracker (iOS) → vault log.
7. **Each VP reports their portion.** Claude Code assembles the unified reply to Sam.

**The user (Sam) never talks to specialists directly. The user talks to Claude Code; Claude Code dispatches via VPs; VPs run specialists.**

---

## Anti-patterns (do not do)

- ❌ **Responding to a Sam prompt without consulting any agent.** Every prompt routes; there is no "trivial enough to skip" threshold.
- ❌ **Defaulting to web-only when Sam didn't specify a platform.** Default is BOTH platforms. Web-only is the explicit exception.
- ❌ Skipping VP orchestration for "small" multi-concern tasks
- ❌ A specialist talking directly to the user (specialists report to their VP, VP reports to CEO)
- ❌ Marking a feature done without IOS_PARITY entry + vault log + quality-reviewer sign-off
- ❌ Cross-team requests bypassing the VP layer (admin should NOT dispatch directly to `ios-dev-screens`; admin notifies `vp-ios` who dispatches)
- ❌ Creating a new agent without `business-hr` proposal + CEO approval
- ❌ Modifying existing agent files without explicit user instruction
- ❌ Inventing routing on the fly when the rules above cover the case. If unclear, RE-READ this file before acting.

---

## 🚨 The default behaviors, summarized in one sentence

**Sam types something → Claude Code reads CLAUDE.md → identifies whether platform scope was specified → dispatches to the right VP(s) (defaulting to BOTH admin + vp-ios for product changes) → VPs run specialists → quality gates → unified reply.**

If a response ever skips any of those steps, the workflow is broken — restart from "read CLAUDE.md."

## Design references (Mobbin MCP)

For UI design tasks (web + iOS), query the Mobbin MCP for real production references before generating layouts. Reference apps to prioritize: Duolingo (gamification patterns), Cash App (speed and feel), Linear (clean minimal), Notion (content-first). If the mobbin MCP server is not connected in the session, note it and proceed with the established design system instead of guessing at trends.
