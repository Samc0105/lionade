# Lionade Agent Org — Map

The full hierarchy of Claude Code agents working on Lionade. 53 agents total.

> **Auto-activation:** see `~/Desktop/lionade/CLAUDE.md` at the project root. That file is loaded on every new Claude Code conversation and tells Claude Code how to route work through this org without manual reminders.

---

## Folder structure

```
.claude/agents/
├── README.md                   ← this file
├── web/                        ← 23 agents — web team
│   ├── admin.md                ← top-level CEO-proxy + VP-Web (orchestrator)
│   ├── design-*.md             ← 3 design specialists
│   ├── design-motion-web.md    ← NEW: animation specialist
│   ├── dev-*.md                ← 5 dev specialists + 2 new
│   ├── dev-realtime-web.md     ← NEW: Supabase Realtime
│   ├── dev-seo-marketing.md    ← NEW: SEO + email templates
│   ├── quality-*.md            ← 3 quality specialists
│   ├── security-*.md           ← 3 security specialists
│   ├── data-*.md               ← 2 data specialists
│   ├── ops-*.md                ← 2 ops specialists
│   └── product-strategist.md   ← shared with business team
├── ios/                        ← 21 agents — iOS team
│   ├── vp-ios.md               ← VP / orchestrator
│   ├── ios-architect.md
│   ├── ios-dev-*.md            ← 6 development specialists
│   ├── ios-design-*.md         ← 3 design specialists
│   ├── ios-security-*.md       ← 2 security specialists
│   ├── ios-qa-tester.md
│   ├── ios-code-reviewer.md
│   ├── ios-docs-writer.md
│   ├── ios-build-eas.md
│   ├── ios-release-appstore.md
│   ├── ios-perf.md
│   ├── ios-parity-tracker.md
│   ├── ios-shared-core.md
│   └── ios-platform-bridge.md
└── business/                   ← 7 agents — business team
    ├── vp-business.md          ← VP / orchestrator
    ├── business-hr.md          ← SPECIAL: hires new agents on gap detection
    ├── business-growth-marketing.md
    ├── business-monetization-finance.md
    ├── business-legal-compliance.md
    ├── business-ops-customer-success.md
    └── business-partnerships-bizdev.md
```

---

## The org chart

```
                              CEO (Sam — human)
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
   admin                       vp-ios                  vp-business
   (Web team)                  (iOS team)              (Business team)
   23 specialists              21 specialists          7 specialists
```

---

## Web team (23 agents)

### Orchestrator
- **`admin`** — Project manager + top-level CEO-proxy. Routes web work + handles domain detection for iOS/business escalation.

### Development (6)
- **`dev-frontend`** — React components, page layouts, state management, Tailwind/glassmorphism
- **`dev-backend`** — API routes, server logic, Supabase queries, auth-protected endpoints
- **`dev-database`** — Schema, migrations, RLS policies, indexes
- **`dev-ai-specialist`** — OpenAI/Anthropic prompt engineering, structured output, token optimization
- **`dev-performance`** — Bundle size, query efficiency, N+1, lazy loading, Lighthouse
- **`design-motion-web`** ⭐ NEW — framer-motion + CSS keyframes animation system
- **`dev-realtime-web`** ⭐ NEW — Supabase Realtime channels (Arena, social, notifications)
- **`dev-seo-marketing`** ⭐ NEW — JSON-LD, sitemap, OG cards, Resend email templates

### Design (3)
- **`design-ui-ux`** — Layouts, interactions, animations, empty/error/loading states
- **`design-copywriter`** — All user-facing text, Ninny's personality, marketing taglines
- **`design-accessibility`** — WCAG 2.1, color contrast, keyboard nav, screen reader, ARIA

### Security (3)
- **`security-auditor`** — Full-codebase vulnerability scan, severity-ranked report
- **`security-auth-guardian`** — `requireAuth()` checks, RLS policies, ownership validation
- **`security-rate-limiter`** — middleware.ts coverage, per-route thresholds

### Quality (3)
- **`quality-code-reviewer`** — Naming, duplication, TypeScript strictness, dead code
- **`quality-qa-tester`** — Test plans, edge cases, end-to-end verification
- **`quality-docs-writer`** — `CLAUDE_AGENT.md`, `FEATURES.md`, `CHANGELOG.md`, IOS_PARITY rows

### Data (2)
- **`data-economist`** — Fangs economy, pricing tiers, reward balances, inflation/deflation
- **`data-analytics`** — Success metrics, SQL queries, DAU/retention/Fangs health

### Operations (2)
- **`ops-deployment`** — Vercel config, env vars, build failures, domain management, SSL, CI/CD
- **`ops-terraform`** — IaC for AWS resources (S3, CloudFront, IAM, Route53)

### Product (1)
- **`product-strategist`** — Feature prioritization, user stories, acceptance criteria, competitor analysis (shared with business team)

---

## iOS team (21 agents)

### Orchestrator
- **`vp-ios`** — iOS team coordinator; mirrors `admin`'s role for the iOS app

### Development (6)
- **`ios-architect`** — Tab structure, screen taxonomy, shared-vs-platform decisions
- **`ios-dev-screens`** — `app/(tabs)/*` + pushed routes, expo-router navigation
- **`ios-dev-components`** — `components/*` + NativeWind + design tokens
- **`ios-dev-native-modules`** — Reanimated, Skia, `@gorhom/bottom-sheet`, expo-blur, gestures, push notifications
- **`ios-dev-data`** — AsyncStorage caching, `@lionade/core` integration, optimistic UI patterns
- **`ios-dev-realtime`** — Supabase Realtime on RN (AppState pause/resume, WebSocket lifecycle)

### Design (3)
- **`ios-design-hig`** — Apple HIG compliance, sheet/modal patterns, native-feel
- **`ios-design-motion`** — Reanimated springs, Skia shaders, gesture choreography, reduce-motion
- **`ios-design-accessibility`** — VoiceOver, Dynamic Type, contrast, motion-reduce

### Security (2)
- **`ios-security-auth`** — Sign in with Apple native flow, keychain, biometric, auth-context
- **`ios-security-auditor`** — Privacy manifest, permissions, App Store compliance rules

### Quality (3)
- **`ios-qa-tester`** — Manual test plans + device matrix + edge cases
- **`ios-code-reviewer`** — RN/TS code quality + iOS-specific gotchas
- **`ios-docs-writer`** — IOS_PARITY updates, CHANGELOG iOS entries, EAS release notes

### Build / Release (3)
- **`ios-build-eas`** — `eas.json`, EAS Build invocation, dev-client vs production
- **`ios-release-appstore`** — App Store Connect, TestFlight, metadata, screenshots
- **`ios-perf`** — Bundle size, JS thread FPS, list virtualization, battery drain

### Cross-platform (3)
- **`ios-parity-tracker`** — Owns IOS_PARITY.md; flags web changes needing iOS ports
- **`ios-shared-core`** — `@lionade/core` extraction patterns; shared-vs-platform decisions
- **`ios-platform-bridge`** — Web↔iOS reconciliation (DiceBear SVG→PNG, daily_target column bug, etc.)

---

## Business team (7 agents)

### Orchestrator
- **`vp-business`** — Non-engineering work coordinator

### Special function
- **`business-hr`** ⭐ — Monitors org for missing roles. Proposes + scaffolds new agent files when gaps appear. **All new "hires" require CEO (Sam) approval before the agent file is saved.**

### Specialists (5)
- **`business-growth-marketing`** — Acquisition strategy, viral mechanics, content marketing, SEO strategy, ASO
- **`business-monetization-finance`** — Pricing, subscription tiers, unit economics, revenue forecasts, Stripe-live decision
- **`business-legal-compliance`** — TOS, Privacy Policy, COPPA/13+ gate, FERPA, real-money-payout regulatory work
- **`business-ops-customer-success`** — support@getlionade.com triage, refund policy, Stripe disputes, churn diagnostics
- **`business-partnerships-bizdev`** — Direct sponsorships, affiliate, B2B Teacher deals

---

## Routing tips (when in doubt)

**The cross-platform default rule (per `CLAUDE.md` Law 2):** any product/feature/UX change where Sam did NOT specify "just web" or "just iOS" routes to BOTH `admin` AND `vp-ios` in parallel. Web-only is the exception, not the default.

| When you're unsure where to route | Default |
|---|---|
| **Sam types a product idea without platform scope** | **BOTH `admin` AND `vp-ios` (cross-platform default)** |
| Sam says "just on web" / "web only" / "for the web app" | `admin` only |
| Sam says "just on iOS" / "iOS only" / "for the iOS app" | `vp-ios` only |
| Backend / infra / SEO / waitlist email | `admin` only (no iOS counterpart by nature) |
| App Store / TestFlight / EAS / iOS-native-API | `vp-ios` only |
| Pricing / marketing strategy / legal / partnerships | `vp-business` (sometimes plus admin + vp-ios for implementation) |
| Animation on a shared surface | `design-motion-web` (web) AND `ios-design-motion` (iOS) — coordinate explicitly |
| Realtime / WebSocket question | `dev-realtime-web` (web) and/or `ios-dev-realtime` (iOS) per scope |
| "Do we have someone for X?" | `business-hr` |
| Cross-team coordination | The receiving VP dispatches to peer VPs — do not skip the chain |
| **Any input where you'd be tempted to skip the agent system** | **STOP. Route anyway. See `CLAUDE.md` Law 1.** |

---

## How to add a new agent (the HR process)

1. **`business-hr` proposes a new role** — name, scope, tools, where they fit, who they collaborate with.
2. **Sam (CEO) reviews + approves or rejects.**
3. **On approval, `business-hr` uses Write to scaffold** the new `.claude/agents/<team>/<name>.md` file in the standard format.
4. **`quality-docs-writer` updates this README + `CLAUDE.md`** to reflect the new hire.
5. **First-use validation** — the new agent runs against a real task; if it works, retained; if it misfires, iterated.

The standard agent file format is documented in `business-hr`'s own .md file.

---

## How to add context to an existing agent (the editing process)

If an existing agent's description / scope / rules need expansion (the codebase grew, a new pattern emerged):

1. The agent that owns the domain proposes the edit (e.g., `dev-frontend` proposes adding context about a new pattern they encountered).
2. **CEO (Sam) approves** any change to an existing agent's file.
3. `quality-docs-writer` applies the edit.
4. Update this README if the change materially shifts the agent's scope.

**Do not edit existing agent files casually.** Their content is load-bearing.

---

## Meta — the philosophy behind this org

1. **Tight scope > vague scope.** "Helps with stuff" agents underperform. Every agent in this org has 1-3 concrete deliverables and an explicit "what you do NOT do."

2. **Orchestration is the default.** A single specialist doing everything ends up doing nothing well. VPs route; specialists execute. The user only talks to VPs.

3. **Quality gates are non-negotiable.** Nothing ships without QA + code review + docs + parity (iOS) + vault log (per standing order).

4. **The org evolves.** `business-hr` exists to hire new roles as gaps appear, not to fix the initial 53-agent design forever.

5. **Cross-platform coordination is explicit.** Shared surfaces (limelight nav, ClaimBanner, etc.) require web + iOS motion + design + dev agents to coordinate. The VPs route those parallel tracks.

---

*Last updated: 2026-05-25. Update when the org changes (new agents, retired agents, structural shifts).*
