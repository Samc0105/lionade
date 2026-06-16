# Feature kill-switch / maintenance mode

A web-only admin kill-switch. An admin can flip any product surface (a whole
page, a card, a single game mode) into `maintenance` from `/admin/features`,
optionally attaching a user-facing message and an ETA. Users see a branded
"we're working on it" screen instead of a half-broken feature, and the server
stops serving that feature's API so the underlying bug stops firing.

This document describes how the system is wired, why the safety rules exist,
and how to add a new gateable feature. It is grounded in the code in this
directory and its siblings; if you change that code, update this file.

## The model

There are exactly two states per feature key:

- `live` — the default. The feature behaves normally.
- `maintenance` — the feature is intentionally down. Users get
  `MaintenanceState`; the feature's API returns `503`.

State is stored one row per overridden key in `public.feature_flags`. The
**absence of a row means `live`** (the safe default, also enforced in the DB).
A feature is only ever down when an admin has explicitly written a row with
`status='maintenance'`.

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

Everything that resolves "is this down?" walks `featureChain` nearest-first and
the **first link in maintenance wins**, so a sub-feature's own row beats its
parent's. This same resolution runs in three places and they must agree:
`assertFeatureLive` (server), `useFeatureStatus` (client), and
`resolveEffective` (admin UI).

The `site` key is the special whole-site node read by `MaintenanceGate`.

## The two enforcement layers

The client gate is UX. The server gate is the boundary.

### 1. Client — `FeatureGate` / `MaintenanceGate` (UX)

`<FeatureGate feature="games.party.sketch" compact?>` wraps a surface. It calls
`useFeatureStatus(feature)`; if the feature is down it renders the branded
`MaintenanceState` instead of the children (`compact` -> inline card for a
sub-feature wrap; otherwise full-screen for a page). Staff still see the real
children with a small fixed "In maintenance (staff view)" ribbon so they can
verify the surface while it is dark for everyone else.

`MaintenanceGate` is the site-wide variant. It reads `useFeatureStatus("site")`
and, when down, replaces the page body for non-staff. It is mounted in
`app/layout.tsx` wrapping `<main>`, inside `ToastProvider` and outside the
`Navbar`, so the nav (a recovery surface) is never hidden.

This layer keeps users from interacting with a known-broken UI, but it runs in
the browser and can be bypassed by anyone who skips the client. It is **not** a
security boundary.

### 2. Server — `assertFeatureLive` (the boundary)

`assertFeatureLive(key)` resolves the same chain server-side and returns a
ready-to-return `503` `NextResponse` if any link is in maintenance, else `null`:

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
serves last-good on DB error). The public client read goes through
`GET /api/feature-flags`.

## Fail-open everywhere

A monitoring / maintenance system must never itself be able to take the site
down. So every layer degrades to "everything is live" when flags cannot be
read:

- **DB / data model:** no row for a key = `live`. A missing table reads as "no
  rows".
- **`getFeatureFlagsCached`:** never throws. On any read failure it serves the
  last known-good cache, or an empty map (= no overrides = all live) if it has
  never read successfully.
- **`GET /api/feature-flags`:** returns `{ flags: {} }` on any error.
- **`useFeatureFlags`:** returns `{}` when SWR has no data, uses
  `barePublicFetcher` (returns `{ flags: {} }` on failure) and
  `shouldRetryOnError: false` so a degraded flag service is not retry-spammed.
- **`assertFeatureLive`:** an empty map means no link is in maintenance, so it
  returns `null` and the feature stays live.

If the whole flag system is broken, the worst outcome is that you cannot put
things into maintenance. You can never accidentally take the site down.

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
   guard:

   ```ts
   const m = await assertFeatureLive('games.newmode');
   if (m) return m;
   ```

The new node appears in `/admin/features` automatically. No migration is needed
to add a feature; the catalog evolves in app code.

## Admin workflow

`/admin/features` (admin only; the API returns 403 to support staff) renders the
catalog as an indented tree so the hierarchy is visible. Each node shows its
**effective** status (down if self or any ancestor is in maintenance, computed
client-side via `featureChain`):

- A **Live / Maintenance toggle** flips the node. Existing message/ETA are
  preserved across a flip.
- An **Edit message + ETA** action (a modal) writes the user-facing copy. It is
  only enabled when the node itself is in maintenance.
- A node down **because of an ancestor** shows "down via <ancestor>" and its own
  toggle is disabled. Flip the parent back to live to restore it.

Every flip is written to the audit log with verb `feature_flag_change`
(metadata `{ key, to, message, eta }`) and invalidates the server cache, so the
change propagates to clients within about a minute (45s client poll + 30s server
TTL, both short-circuited by the cache invalidation).

Keep the message short and reassuring. ETA is optional and free text (for
example "Back by 5pm ET"). User-facing copy avoids em-dashes.

## Setup

The table is created by `lib/migrations/20260616150000_feature_flags.sql`. **Run
it manually** in the Supabase SQL editor; no app code applies it. It is
idempotent and safe to re-run. It:

- creates `public.feature_flags` with the `updated_at` trigger;
- enables RLS with an admin-only `FOR ALL` policy via
  `public.current_app_role() = 'admin'` (defined in migration 057, not
  redefined here);
- revokes all from `anon` and grants to `authenticated`.

Public reads go through the **service role**, never `anon`. Until the migration
is run, every read fails open and the admin UI shows a "run the migration first"
notice while everything stays live.

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
- **There is a propagation delay** of up to roughly a minute on already-open
  tabs (client poll + server cache), short of an immediate cache invalidation
  from an admin flip.

## Type note

`feature_flags` is applied manually and is not in the generated Supabase types,
so the server reads/writes use untyped `.from("feature_flags")`. This is the one
documented Supabase-type gap; columns match the migration exactly and rows are
narrowed by hand. There is no other use of `any`.
