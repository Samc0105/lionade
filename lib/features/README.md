# Feature kill-switch / maintenance mode (v2)

A web-only admin kill-switch. An admin can flip any product surface (a whole
page, a card, a single game mode) into `warning` or `maintenance` from
`/admin/features`, optionally attaching a user-facing message, an ETA, and a
scheduling window. In `maintenance` users see a branded "we're working on it"
screen and the server stops serving that feature's API so the underlying bug
stops firing. In `warning` the feature stays fully usable and the API is never
blocked; users just see a dismissible "known issue" banner.

This document describes how the system is wired, why the safety rules exist,
and how to add a new gateable feature. It is grounded in the code in this
directory and its siblings; if you change that code, update this file.

## The model (three states)

There are exactly three states per feature key:

- `live` — the default. The feature behaves normally.
- `warning` — the feature is **still usable**. Users see a dismissible
  "known issue" banner above the surface; the **API is NOT blocked**. Use this
  for a degraded-but-working surface where you want to set expectations without
  taking it down.
- `maintenance` — the feature is intentionally down. Users get
  `MaintenanceState`; the feature's API returns `503`.

State is stored one row per overridden key in `public.feature_flags`. The
**absence of a row means `live`** (the safe default, also enforced in the DB).
A feature is only ever in `warning`/`maintenance` when an admin has explicitly
written a row with that `status`.

### The scheduling window (auto-clearing, no cron)

Each row may carry a `starts_at` / `ends_at` window (both `timestamptz`, both
nullable). The **effective status is computed window-aware at READ TIME and is
never stored**:

- `starts_at` null -> active immediately; otherwise the override only counts
  once `now >= starts_at`.
- `ends_at` null -> open-ended; otherwise the override stops counting once
  `now > ends_at`.

A `warning`/`maintenance` row outside its window resolves to `live`. The
consequence is that **expiry needs NO cron**: an expired override simply reads
as `live` on the next request and the maintenance/warning UI disappears on its
own. The same resolution runs in `effectiveStatus()` (server,
`lib/feature-flags.ts`), `effectiveOf()` / `resolveEffective()` (the
`/admin/features` UI), and is **pre-resolved for clients** by the public
endpoint (see below), so the browser never recomputes a window. Unparseable
bounds fail-open: a malformed `starts_at` is treated as "no lower bound", a
malformed `ends_at` as "no upper bound", so a bad timestamp never strengthens a
gate.

### Hierarchy

Keys are dot-paths: `games`, `games.party`, `games.party.sketch`. A feature is
**down if it, or ANY of its dot-path ancestors, is in `maintenance`**. So
putting `games.party` into maintenance takes `sketch`, `bluff`, `pokerface`,
and `trivia` down with it; putting `games` into maintenance takes the whole
arcade down.

The walk is pure and lives in `catalog.ts`:

- `ancestorsOf("games.party.sketch")` -> `["games.party", "games"]` (nearest
  first). It is a string walk, not a catalog lookup, so even an unknown key
  resolves its dot ancestors.
- `featureChain(key)` -> `[key, ...ancestorsOf(key)]`.

Resolution walks `featureChain` nearest-first in two passes:
**effective `maintenance` anywhere in the chain wins** (the surface is
replaced); only if nothing in the chain is in maintenance does the **nearest
effective `warning` win** (the surface stays usable with a banner). The nearest
member of each kind is preferred, so a sub-feature's own row beats its parent's,
and maintenance always beats warning. "Effective" means window-resolved: a
windowed row outside its window does not participate. This same resolution runs
in three places and they must agree: `assertFeatureLive` (server, maintenance
only — see below), `useFeatureStatus` (client), and `resolveEffective` (admin
UI).

The `site` key is the special whole-site node read by `MaintenanceGate`.

### The catalog (expanded in v2)

`FEATURE_CATALOG` in `catalog.ts` is the single allow-list of gateable keys. v2
broadened it well past whole pages down to individual cards and sub-features, so
an operator can take down one widget without darkening its whole page. The
top-level hubs and a sample of their sub-features:

- `site` — the whole-site node.
- `dashboard` — `daily_bet`, `missions`, `bounties`, `subject_stats`,
  `leaderboard_preview`, `recent_quizzes`, `level_progress`, `circular_stats`.
- `learn` — `daily_goal`, `study_heatmap`, `subject_mastery`, `vocab`, `paths`,
  `recent_activity`.
- `social` — `circle_pulse`, `showdown`, `squad_goal`, `activity_feed`,
  `friend_list`, `chat_thread`, `notifications`, `lobbies`.
- `leaderboard`, `academia` — single nodes.
- `shop` (Lion's Den) — `daily_spin`, `fang_iap`, `featured`, `cosmetics`,
  `boosters`, `inventory`, `premium_cosmetics`, `founder_badges`.
- `games` (Arcade) — `roardle`, `flashcards`, `timeline`, `pardy`, and
  `games.party` -> `sketch`, `bluff`, `pokerface`, `trivia`.
- `compete` — `blitz`, `duel`, and `compete.arena` -> `sabotage`, `zoom`,
  `spectrum`, `pin`.

The list is the source of truth; consult `catalog.ts` for the exact set. **No
recovery surface has a node** (`/admin/*`, `/login`, `/signup`, `/onboarding`,
`/onboard/*`, `/settings/*`, the auth / account / quiz-core APIs, the Navbar,
the flag system itself) — that exclusion is by construction (see the never-gate
list below).

## The two enforcement layers

The client gate is UX. The server gate is the boundary.

### 1. Client — `FeatureGate` / `MaintenanceGate` (UX)

`<FeatureGate feature="games.party.sketch" compact?>` wraps a surface. It calls
`useFeatureStatus(feature)` and renders one of three ways:

- **maintenance** in the chain -> non-staff get the branded `MaintenanceState`
  instead of the children (`compact` -> inline card for a sub-feature wrap;
  otherwise full-screen for a page). Staff still see the real children with a
  small fixed "In maintenance (staff view)" ribbon so they can verify the
  surface while it is dark for everyone else.
- **warning** in the chain (and no maintenance) -> **everyone** (staff
  included) keeps the real children, with a dismissible `FeatureWarningBanner`
  ("Known issue") rendered above them. Dismissal persists in `sessionStorage`
  keyed by the warning's feature key, so it stops nagging for the tab session
  but returns in a fresh session if the issue is still flagged.
- **live** -> children only.

`MaintenanceGate` is the site-wide variant. It reads `useFeatureStatus("site")`
and:

- **maintenance** -> replaces the page body for non-staff. Staff bypass so an
  admin can still reach `/admin` to lift the flag. While the role is still
  resolving it holds the children rather than briefly flashing the maintenance
  screen at a staff member.
- **warning** -> keeps the whole app usable and adds a slim informational bar
  at the very top for everyone.

It is mounted in `app/layout.tsx` wrapping `<main>`, inside `ToastProvider` and
outside the `Navbar`, so the nav (a recovery surface) is never hidden.

This layer keeps users from interacting with a known-broken UI, but it runs in
the browser and can be bypassed by anyone who skips the client. It is **not** a
security boundary.

### 2. Server — `assertFeatureLive` (the boundary)

`assertFeatureLive(key)` resolves the same chain server-side and returns a
ready-to-return `503` `NextResponse` if any link's effective status is
`maintenance`, else `null`. **`warning` is NOT a gate** — a feature in warning
stays fully usable, so `assertFeatureLive` returns `null` for it and the API
runs normally. Only `maintenance` 503s:

```ts
const m = await assertFeatureLive('games.party.sketch');
if (m) return m;   // place RIGHT AFTER the auth guard
```

The 503 body is:

```json
{
  "error": "This feature is temporarily unavailable.",
  "maintenance": { "feature": "<the link that is down>", "message": "...", "eta": "..." }
}
```

This is what actually stops a broken feature from doing damage: the endpoint
refuses to run, so the bug behind the maintenance flag stops firing regardless
of what client is calling it. The client gate is the polite face; this is the
wall.

The flag map is read by `getFeatureFlagsCached()` (in-process cache, ~30s TTL,
serves last-good on DB error). It returns RAW rows including the window;
`assertFeatureLive` resolves each row through `effectiveStatus(row, now)` so a
windowed override outside its window is treated as live. The public client read
goes through `GET /api/feature-flags`, which **pre-resolves the window** and
returns only effective `warning`/`maintenance` keys (live and out-of-window
rows are omitted, so a missing key means live on the client).

### 3. Global status banner — `MaintenanceStatusBanner` (informational)

`MaintenanceStatusBanner` is a slim, dismissible top bar that lists **every**
feature currently in an effective `warning` or `maintenance` state, anywhere on
the site, so a degraded surface is discoverable from any page. It reads
`useFeatureFlags()` (windows already pre-resolved by the public endpoint),
phrases maintenance and warnings as separate dash-free sentences, and is purely
informational: it never blocks a page, never hides the nav, and never replaces
content (the per-surface gates do the actual gating). Staff see it too.

It is mounted in `app/layout.tsx` inside `<main>`, **above** the
`MaintenanceGate` body so it shows on live pages. Dismissal persists in
`sessionStorage` keyed by the exact, order-independent set of affected feature
keys, so dismissing it stops the nag for the tab session but a NEW feature going
into warning/maintenance produces a fresh (different-signature) banner. Fail-
open: an empty flag map renders nothing.

## Fail-open everywhere

A monitoring / maintenance system must never itself be able to take the site
down. So every layer degrades to "everything is live" when flags cannot be
read:

- **DB / data model:** no row for a key = `live`. A missing table or missing
  v2 column (`starts_at` / `ends_at`) reads as "no rows" / "no bound".
- **`getFeatureFlagsCached`:** never throws. On any read failure it serves the
  last known-good cache, or an empty map (= no overrides = all live) if it has
  never read successfully.
- **`effectiveStatus` (window resolution):** an unparseable `starts_at` is
  treated as no lower bound and an unparseable `ends_at` as no upper bound, so a
  malformed timestamp never strengthens a gate.
- **`GET /api/feature-flags`:** returns `{ flags: {} }` on any error, and omits
  every live / out-of-window key.
- **`useFeatureFlags`:** returns `{}` when SWR has no data, uses
  `barePublicFetcher` (returns `{ flags: {} }` on failure) and
  `shouldRetryOnError: false` so a degraded flag service is not retry-spammed.
- **`assertFeatureLive`:** an empty map means no link is in maintenance, so it
  returns `null` and the feature stays live. A `warning` is never a gate.

If the whole flag system is broken, the worst outcome is that you cannot put
things into warning or maintenance. You can never accidentally take the site
down.

## The never-gate exclusion list (and why)

A flag must **never** be able to lock anyone out of recovery. The following are
never gateable:

- `/admin/*` (this console — an admin must always be able to lift a flag)
- `/login`, `/signup`, `/onboarding`, `/onboard/*`
- `/settings/*`
- the auth / account / quiz-core APIs
- the `Navbar`
- the feature-flag system itself

**Why:** if `site` is in maintenance and an admin could be locked out of
`/admin`, no one could ever lift the flag. The whole point of a kill-switch is
that the person holding it can always reach the switch.

This is enforced by three independent mechanisms, no one of which is trusted
alone:

1. **The catalog excludes them by construction.** There is simply no node in
   `FEATURE_CATALOG` for any recovery surface, so there is nothing to toggle.
2. **The admin POST route re-validates.** `POST /api/admin/features` rejects any
   key not in the catalog with a `400` before any write, so a never-gate row
   can never be inserted even by a crafted request.
3. **Staff bypass.** `MaintenanceGate` and `FeatureGate` let staff through, so
   even with `site` in maintenance an admin can reach `/admin` to lift it.

## Staff bypass

`useAdminRole().isStaff` (support or admin) bypasses both gates:

- `FeatureGate` renders the real children to staff with the "staff view" ribbon.
- `MaintenanceGate` renders children to staff, so admins can always reach
  `/admin` to lift a `site` flag.

Bypass is UX only. Staff get to *see* the surface; the server-side
`assertFeatureLive` does not exempt staff, so a staff member hitting a gated API
still gets the 503. That is intentional: the maintenance flag usually exists
because the backend is misbehaving, and you do not want staff traffic firing the
same bug.

## Adding a new gateable feature

Three steps:

1. **Add one catalog line** in `lib/features/catalog.ts`, with the right
   `parentKey` so it slots into the hierarchy:

   ```ts
   { key: "games.newmode", label: "New Mode", parentKey: "games" },
   ```

   Never add a recovery surface here. If a key would gate login, settings,
   `/admin`, auth APIs, or the Navbar, do not add it.

2. **Wrap the surface** in `<FeatureGate>` (use `compact` for a card inside a
   page; omit it for a full page):

   ```tsx
   <FeatureGate feature="games.newmode">
     <NewMode />
   </FeatureGate>
   ```

3. **Add the server guard** on the feature's API route(s), right after the auth
   guard. This only gates `maintenance` (a `warning` keeps the API live), which
   is the intended behavior:

   ```ts
   const m = await assertFeatureLive('games.newmode');
   if (m) return m;
   ```

The new node appears in `/admin/features` automatically with all three states
and the schedule editor. No migration is needed to add a feature; the catalog
evolves in app code.

## Admin workflow

`/admin/features` (admin only; the API returns 403 to support staff) renders the
catalog as an indented tree so the hierarchy is visible. Each node shows its
**effective**, window-resolved status (computed client-side via `featureChain`
+ `resolveEffective`), summarised by two header counters (maintenance / warning):

- A **three-way Live / Warning / Down control** flips the node. Existing
  message / ETA / window are preserved when escalating severity (warning <->
  maintenance); picking **Live** clears the override and its schedule.
- An **Edit** action (a modal) writes the user-facing copy: a `warning` /
  `maintenance` severity picker, the message, an optional ETA, and an optional
  **schedule window** (start / end, entered in the admin's local time and stored
  as UTC ISO). Server and client both validate that `ends_at` is after
  `starts_at`.
- A row whose window has not opened yet shows a **"scheduled"** pill (it
  currently resolves to live); a row whose window has expired resolves back to
  live on its own (auto-clear).
- A node down **because of an ancestor** shows "down via <ancestor>" and its own
  control is disabled. A node in warning via an ancestor shows "warn via
  <ancestor>" but stays controllable. Flip the parent back to live to restore a
  subtree.

Every change is written to the audit log with verb `feature_flag_change`
(metadata `{ key, to, message, eta, startsAt, endsAt }`) and invalidates the
server cache, so the change propagates to clients within about a minute (45s
client poll + 30s server TTL, both short-circuited by the cache invalidation).

Keep the message short and reassuring. ETA is optional and free text (for
example "Back by 5pm ET"). User-facing copy avoids em-dashes.

## Setup

Two migrations, both run **manually** in the Supabase SQL editor (no app code
applies them), both idempotent and safe to re-run:

- `lib/migrations/20260616150000_feature_flags.sql` (v1) creates
  `public.feature_flags` with the `updated_at` trigger; enables RLS with an
  admin-only `FOR ALL` policy via `public.current_app_role() = 'admin'` (defined
  in migration 057, not redefined here); revokes all from `anon` and grants to
  `authenticated`.
- `lib/migrations/20260616160000_feature_flags_v2.sql` (v2) widens the `status`
  CHECK to allow `'warning'` (dropping the auto-named v1 check name-agnostically
  and re-adding a named `feature_flags_status_check`), adds the nullable
  `starts_at` / `ends_at` window columns, and creates the
  `security_alerts_sent` dedup ledger used by the SOC alert cron (see
  `lib/security/README.md`).

Public reads go through the **service role**, never `anon`. The routes tolerate
the table or the v2 columns being absent: until both migrations are run, every
read fails open and the admin UI shows a "run the migrations first" notice while
everything stays live.

## Honest about the limits

- **The client gate is UX, not a boundary.** `FeatureGate` and `MaintenanceGate`
  run in the browser and can be bypassed. They prevent honest users from poking
  at a broken UI; they do not protect the backend.
- **The server boundary is `assertFeatureLive` plus the never-gate list.** A
  feature is only truly off when its API route has the `assertFeatureLive` guard.
  A `<FeatureGate>` with no matching server guard is decoration: the UI hides,
  but a direct API call still runs.
- **A maintenance flag is per-feature, not a code rollback.** It stops a surface
  from being reached; it does not undeploy the bug. Use it to buy time, then fix
  and lift.
- **`warning` is a heads-up, not a gate.** It never 503s and the surface stays
  fully functional, so it does not stop a misbehaving backend — reach for
  `maintenance` when you actually need the API to stop.
- **The schedule window resolves at read time, not on a timer.** An expired
  override only flips back to live on the next read (capped by the ~30s server
  cache + 45s client poll), so a window does not clear to the exact second.
- **There is a propagation delay** of up to roughly a minute on already-open
  tabs (client poll + server cache), short of an immediate cache invalidation
  from an admin flip.

## Type note

`feature_flags` is applied manually and is not in the generated Supabase types,
so the server reads/writes use untyped `.from("feature_flags")` (now selecting
the v2 `starts_at` / `ends_at` columns too). This is the one documented
Supabase-type gap for this subsystem; columns match the v1 + v2 migrations
exactly and rows are narrowed by hand at every call site. There is no other use
of `any`.
