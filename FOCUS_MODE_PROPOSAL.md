# Focus Mode — Proposal & Feasibility (v2)

**Author:** Sam · **Originator:** Dawda · **Date:** 2026-05-02
**Status:** Proposal — for team review
**Changed in v2:** Screen-lock is now the headline approach; camera is relegated to an optional Platinum-tier feature. Added "active sessions" — partial-credit logging for sessions that don't finish.

---

## 1. The Idea

Dawda's pitch (lightly cleaned up):

> Add a focus mode where the user sets a timer (e.g. 2hr, 3hr) for how long they want to study. The app gives warnings when it detects distractions, and after a certain number of distractions, it ends the session.

The original pitch suggested camera-based proctoring like a lockdown browser. We can get **90% of that feel without any camera, and without any permission prompts**, using browser primitives that already exist:

- Fullscreen lock, pointer lock, tab-switch detection, app-blur detection, idle-timer detection, PWA installation.

Camera mode stays on the roadmap as a Platinum-tier optional add-on (§5.4) — it's the right tool for the very small slice of users who want maximum proctoring (parents, certification grinders) — but it shouldn't be the default vision.

---

## 2. What We Have Today

`components/FocusLockIn.tsx` already ships a sealed-session focus tool. Foundation is solid; we're extending it.

| Feature | Today |
|---|---|
| Duration presets | 25 / 45 / 60 min |
| Persistent timer overlay | Yes — floats across all pages |
| Completion reward | 25 / 50 / 75 Fangs |
| Drift-tolerant timing | Yes — `Date.now()`-based |
| **Bail behavior** | **All-or-nothing — bail = 0 Fangs** |
| Distraction detection | None |
| Long sessions (90min+) | No |
| Anti-cheat enforcement | None |
| Session history / log | No |

Two big gaps to close: **bail = 0 is too punitive** (Dawda's "active sessions" insight, §4), and **no enforcement** means it's purely honor-system right now.

---

## 3. The Pivot — Screen-Lock Over Camera

Camera-based proctoring is technically doable but legally and reputationally expensive. Screen-lock gets us most of the way there with none of the cost.

### 3.1 What screen-lock can actually do (no permissions needed)

| Tech | What it does | Cost |
|---|---|---|
| `document.visibilitychange` | Detects tab switch, app switch, screen lock — instant signal | Free |
| `Element.requestFullscreen()` | Forces the app into fullscreen; user has to consciously press Esc to leave | Free |
| `requestPointerLock()` | Captures the mouse cursor inside the app | Free |
| `window.blur` events | Detects clicking onto another window | Free |
| Idle timer (no `mousemove`/keypress) | Warns after >5 min of zero input during a session | Free |
| PWA install ("Add to Home Screen") | App runs in its own window with no browser chrome — feels native | 2 days |

Stacked together, these are genuinely hard to defeat without conscious intent to bail — and crucially, the user *knows they bailed*. No surveillance, no awkward "what data did Lionade just see," no privacy theater.

### 3.2 Why this is enough

This is the **Forest app model**. Forest has 2M+ paying users on a pure-honor-system focus tool. Cold Turkey, BlockSite, Freedom — all in this category, all at multi-million-user scale. The market doesn't *need* cameras to take focus tools seriously; it needs the friction of intentional bailing to be high enough to feel meaningful.

### 3.3 The browser extension upgrade (real lockdown-browser behavior)

For users who want *more*, the Pro/Platinum upgrade is a Chrome/Edge/Firefox extension that **actually blocks distracting websites** during an active focus session. Twitter, TikTok web, Reddit, YouTube → "you're locked in for 47 more minutes" interstitial. This is what Cold Turkey ($39 one-time) and Freedom ($8.99/mo) sell on; it's a real product with a real market.

Engineering cost for v1 extension: ~2–3 weeks. Worth doing only after Phases 1+2 ship and we see who actually opts in.

---

## 4. Active Sessions — Half-Counts Count

The single biggest UX shift in v2.

**Today:** start a 60-min session, bail at minute 47, get 0 Fangs. Punishes users for trying.

**Proposed:** every focus session gets logged, regardless of how it ends. Partial completions earn partial Fangs. Session history shows up in the user's profile + dashboard.

### 4.1 The reward formula

| Session length | Minimum to count | Reward at completion | Reward formula |
|---|---|---|---|
| 25 min | 5 min | 25F | `min(actual / 25 × 25, 25)` |
| 45 min | 5 min | 50F | `min(actual / 45 × 50, 50)` |
| 60 min | 5 min | 75F | `min(actual / 60 × 75, 75)` |
| 90 min | 10 min | 150F | `min(actual / 90 × 150, 150)` |
| 2 hr | 15 min | 300F | `min(actual / 120 × 300, 300)` |
| 3 hr | 20 min | 500F | `min(actual / 180 × 500, 500)` |

A "minimum to count" floor exists so micro-sessions can't be farmed. Below the floor: 0 Fangs, but the session still gets logged for stats (with a "didn't reach minimum" badge).

### 4.2 Completion bonus (the carrot)

To preserve the "going all the way is meaningfully better" instinct, completed sessions get a **+50% completion bonus** on top of the linear reward.

So a 60-min session at 47 min = 47/60 × 75 = **58 Fangs partial**.
A 60-min session at exactly 60 min = 75 × 1.5 = **113 Fangs full** (linear + 50% completion bonus).

That's a real gap (~95% more Fangs for finishing) that motivates following through, without zero-ing out the partial effort.

### 4.3 What gets logged

Every session records:
- Start time, end time, total focus minutes
- Reason it ended: `completed` / `user_bailed` / `distraction_kicked` / `device_idle` / `tab_switched_too_much`
- Number of distraction events during the session
- Fangs awarded
- Class context (if started from a class page — `classes/[id]/page.tsx`)

This unlocks:
- **Profile stat:** "127 total focus hours · longest session 2h 47min · current focus streak: 12 days"
- **Per-class focus minutes** — "you've focus-locked 8h on Calculus this month"
- **Dashboard widget** — weekly focus chart
- **Daily focus streak** — separate from the quiz streak; missing a day breaks it
- **Bounty trigger** — "complete 10 focus sessions this week → 250F"

### 4.4 Schema sketch

```sql
create table focus_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  class_id        uuid references classes(id) on delete set null,  -- nullable: not all sessions tied to a class
  duration_target int  not null,                                    -- minutes user picked
  duration_actual int  not null,                                    -- minutes they actually stayed
  started_at      timestamptz not null,
  ended_at        timestamptz not null,
  end_reason      text not null check (end_reason in ('completed','user_bailed','distraction_kicked','device_idle','tab_switched')),
  distractions    int  not null default 0,
  fangs_earned    int  not null default 0,
  created_at      timestamptz not null default now()
);

create index focus_sessions_user_started_idx on focus_sessions (user_id, started_at desc);
create index focus_sessions_user_class_idx on focus_sessions (user_id, class_id);
```

---

## 5. Phased Rollout

### 5.1 Phase 1 — Long Sessions + Soft Detection + Active Logging
**Effort:** ~1 week · **Permissions:** none · **Tier:** all users

Most of v2 lives here. Ship together:

- Add 90min / 2hr / 3hr presets to `FocusLockIn.tsx`
- Add `focus_sessions` table (migration 046)
- Log every session — completed AND bailed
- Implement the partial-credit reward formula (§4.1) + completion bonus (§4.2)
- Soft distraction detection via `visibilitychange` + `window.blur` + idle timer
- 3-strike system (with the 3rd auto-ending the session — but the active minutes still count)
- New profile stat block + weekly focus chart on dashboard
- Daily focus streak (separate from quiz streak)

### 5.2 Phase 2 — Hard Screen-Lock
**Effort:** ~1 week · **Permissions:** fullscreen prompt only · **Tier:** all users

Layered on top of Phase 1, this is the "real Lock-In" mode:

- Optional toggle on session-start: "Strict mode" 🔒
- Calls `requestFullscreen()` + `requestPointerLock()` on session start
- Exiting fullscreen counts as a distraction strike (still logged via Phase 1's system)
- PWA manifest update so installed Lionade users get a native-feeling lock
- Strict mode pays a 25% Fangs bonus on top of the partial/completion reward — incentive to opt in

After Phase 2, the experience is: pick a duration → strict mode → fullscreen takes over → timer floats → you bail or finish → you get logged credit either way. **This is the headline feature ship.**

### 5.3 Phase 3 — Browser Extension (Real Site Blocking)
**Effort:** ~2-3 weeks · **Permissions:** extension install (one-time) · **Tier:** Pro+

Manifest V3 Chrome extension that:

- Pairs with the user's Lionade account via auth token
- Listens for "focus session started" events from the web app
- Blocks a configurable list of distracting sites (default: TikTok, Twitter/X, Reddit, YouTube, Instagram, Facebook) for the duration of the session
- Shows a Lionade-branded lockout page: "You're locked in. 47 minutes left."
- Releases the block automatically when the session ends

Why Pro-tier: this is genuinely engineering-heavy and the value is high — Cold Turkey charges $39 once, Freedom $8.99/mo. We can make this a Pro-only feature at $6.99/mo and it pulls real upgrade weight.

### 5.4 Phase 4 — Camera Mode (Optional Platinum Add-On)
**Effort:** ~3-4 weeks · **Permissions:** camera + age-gate + privacy review · **Tier:** Platinum-only, opt-in

The original Dawda vision, scoped down. Only ship if Phases 1–3 demand it (real users asking for stricter proctoring).

- Opt-in toggle on session-start, default OFF
- Camera permission prompt
- TF.js BlazeFace runs locally — never transmits frames
- Detects: no face for 30s, face turned >45° for 30s, multiple faces detected
- Tiny PiP camera preview in corner so user knows it's running (trust)
- 2× Fangs multiplier on top of strict mode bonus

Same five non-negotiable rules from v1 of this doc apply: on-device only, no recording, opt-in, age-gated (18+ default with parental consent under), privacy policy update + legal review.

### 5.5 Phase 5 — Native Mobile
**Effort:** part of iOS/Android app work · **Tier:** all users (matches web tier)

iOS Safari kills web camera in backgrounded tabs anyway. Native Expo app can:
- Integrate with iOS Focus Mode + Apple Screen Time
- Use `expo-screen-capture` to detect screen recordings
- Fire local notifications on distraction
- Run in background longer than web

---

## 6. Comparable Products

| Product | Approach | Pricing | Why we should care |
|---|---|---|---|
| **Forest** | Pure honor system + planted-tree gamification | $3.99 once / $1.99/yr Pro | 2M+ paying users on no-enforcement model |
| **Flora** | Forest + group sessions | Free + $5/mo Pro | Group focus rooms = our V1.5 feature |
| **Cold Turkey Blocker** | Desktop-level site/app blocker | $39 once | Phase 3 (extension) target market |
| **Freedom** | Site blocker, multi-device sync | $8.99/mo | Same — proves recurring revenue model |
| **Brain.fm / Endel** | Focus music, no enforcement | $9.99/mo | We already have Focus Music — paired with Lock-In = differentiated |
| **Respondus / Honorlock** | Camera-based proctoring | B2B per-license | Phase 4 reference — but exam proctoring, not study |

The gap in the market: **no one combines gamified study rewards with hard screen-lock + active session logging.** Forest is closest but has no rewards economy and no study integration. Lionade owns this lane if we ship Phases 1+2.

---

## 7. Where This Plugs Into the Master Plan

This feature touches three of the master plan's pillars:

- **Grow pillar** — Focus Lock-In is the cleanest "pure earned" Fangs faucet. Active sessions deepen retention by ensuring even imperfect days feel productive.
- **Pro upgrade lever** — Phase 3 (browser extension) is the headline Pro-tier feature. "You want real site-blocking? That's $6.99/mo." Section 13.2 of the master plan flagged we need stronger paywall triggers — this is one.
- **Family Console** — parents pay $19.99/mo for a plan where they can see their kid's verified focus history. Active session logs (§4) are the data product Family Console sells.

Expected impact on master plan KPIs (best estimate, not guaranteed):
- **Daily Active Users** — focus mode is a daily-return ritual. +10–15% DAU lift if Phase 1 ships well, based on Forest's engagement data.
- **Pro conversion** — +1–2 percentage points if the extension ships as Pro-only.
- **Session length / time on app** — long focus sessions are 3-hour app sessions. Material lift.

---

## 8. Open Questions for Dawda + Team

1. **Active session minimums** — is 5 minutes the right floor, or higher? Lower is more inclusive but more farmable.
2. **Completion bonus % — 50% feels right?** Big enough to motivate finishing without dwarfing partial effort.
3. **Distraction strike threshold** — should it scale with session length? Default proposal: 3 strikes for ≤45min sessions, 5 strikes for 60–90min, 7 for 2–3hr.
4. **Should Strict Mode be the default**, or always opt-in? Opt-in is friendlier; default-on creates a stronger product identity.
5. **Group focus rooms (Flora-style)** — Phase 1.5 or punted? My take: punt to V1.5 after we have solo data, but it's not far away.
6. **Extension scope** — open-source the extension (transparency play, lower trust barrier), or keep it private?
7. **Apple Watch wrist-tap on distraction** — niche but iconic. Shelve until iOS app ships.

---

## 9. Recommended Next Step

**Ship Phase 1 in 1–2 weeks.** It's the foundation everything else builds on:
- Migration 046 for `focus_sessions`
- Updated `FocusLockIn.tsx` with new presets + partial reward + soft detection
- New profile stat block + weekly chart
- Daily focus streak

Phase 2 follows in another week (low marginal effort once Phase 1 is in). Together they're the headline ship — "Lionade Lock-In" — that we can market.

Phases 3 and 4 wait on real Phase 1+2 usage data. If we see users opting into longer + stricter sessions and asking "can I block specific sites," ship Phase 3. If we see a meaningful ask for camera-based proctoring (especially from parents/Family Plan users), ship Phase 4 — otherwise leave it on the shelf.

Total realistic 2026 effort if we ship through Phase 3: **~6 weeks of focused engineering**, spread across Q3 alongside other work.

---

*Linked: `LIONADE_MASTER_PLAN.md` §11.1 (high-confidence wins), §13.2 (paywall-trigger open questions), `components/FocusLockIn.tsx` (existing implementation).*
