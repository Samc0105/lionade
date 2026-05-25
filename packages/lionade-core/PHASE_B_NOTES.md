# Phase B coordination notes — `@lionade/core` cache + storage

Status: **WEB-SIDE READY 2026-05-25.** Web (admin team) has completed its Phase B work
consuming the `@lionade/core/cache/storage` shared factory + `StorageAdapter`
interface that `ios-shared-core` shipped earlier the same day. This file collects
follow-up coordination items for iOS to action.

> Per CLAUDE.md, admin (web) does NOT edit `packages/lionade-core/` source. All
> items below are PROPOSALS for `ios-shared-core` to apply and ship.

---

## 1. Shared storage adapter — consumed cleanly ✅

`ios-shared-core` shipped:
- `interface StorageAdapter` — used by `lib/cache/localStorageAdapter.ts`
- `createPersistedSwrProvider(adapter, opts)` — used by `lib/swr-config.ts`
- `SWR_PERSIST_KEY` constant — used by the skip-list interceptor

No interface changes requested from web's side. The factory's `onError`
callback hook was particularly nice — web wires it to console.warn in dev
and will route to Sentry once that's wired (web Sentry is a separate task).

One small additive proposal for a future iteration (NOT a blocker — web works
fine without it):

- An optional `serialize` / `deserialize` hook on `createPersistedSwrProvider`
  so platform-specific compression (web: `CompressionStream`) or schema
  versioning could plug in without re-wrapping the adapter. Not needed today;
  filing for the cache-shape-bump conversation later.

---

## 2. Cache key drift — items where web inline keys don't match registry helpers

Phase A added `@lionade/core/cache/keys.ts` with a partial registry. Web has a
few hooks whose inline string format DIFFERS from the registry helpers in ways
that prevent a drop-in migration. Each one is a request for iOS to extend the
shared registry. Web will migrate its hook the moment the helper exists.

Phase B migrated the one hook that DID match (`useUserStats` →
`cacheKeys.userStats(userId)`). All other 26 useSWR sites are pending the
helpers listed below.

### 2a. Notifications — namespacing
- Inline (web today): `notifications/${userId}`
- Registry: `cacheKeys.notifications()` → `/api/notifications`
- **Question for iOS:** Does iOS notifications key on userId for cross-device
  sign-out isolation, or unkeyed? If userId-namespaced, propose:
  `cacheKeys.notifications: (userId) => \`notifications/${userId}\``.

### 2b. Friends — namespacing
- Inline (web): `social-friends/${userId}`
- Registry: `cacheKeys.friends()` → `/api/social/friends`
- **Same question** as 2a — pick one form.

### 2c. Badges — naming
- Inline (web): `user-badges/${userId}`, `all-badges`
- Registry: `cacheKeys.badges(userId)` → `badges/${userId}` (no `all-badges`)
- **Proposal:** Add `cacheKeys.allBadges()` → `all-badges`, and EITHER rename
  `badges(userId)` to `userBadges` OR keep `badges` (web will accept either —
  string match is the goal).

### 2d. Quiz history — limit param
- Inline (web): `quiz-history/${userId}/${limit}`
- Registry: `cacheKeys.recentQuizzes(userId)` → `recent-quizzes/${userId}`
- **Proposal:** `cacheKeys.quizHistory: (userId, limit) => \`quiz-history/${userId}/${limit}\``
  — different limits should NOT share a cache slot.

### 2e. Subject stats — lifetime variant
- Inline (web): `subject-stats/${userId}/${lifetime}` (lifetime is `"lifetime"` or `"window"`)
- Registry: `cacheKeys.subjectStats(userId)` → `subject-stats/${userId}`
- **Proposal:** `cacheKeys.subjectStats: (userId, lifetime: "lifetime" | "window") => ...`

### 2f. Leaderboards — limit + variant
- Inline (web): `leaderboard-weekly/${limit}`, `leaderboard-elo/${limit}`
- Registry: `cacheKeys.leaderboard()` → `leaderboard`
- **Proposal:** Split into `cacheKeys.weeklyLeaderboard(limit)` and
  `cacheKeys.eloLeaderboard(limit)`.

### 2g. Streak info
- Inline (web): `streak-info/${userId}`
- No registry helper.
- **Proposal:** `cacheKeys.streakInfo: (userId) => \`streak-info/${userId}\``.

### 2h. Missions progress — namespacing
- Inline (web): `learn-missions/${userId}` and `dashboard-missions/${userId}`
- Registry: `cacheKeys.missionsProgress()` → `/api/missions/progress`
- **Question:** unkeyed (relies on session auth) or userId-namespaced? Web has
  drift between two pages — happy to consolidate either way.

### 2i. Web-only keys NOT proposed for sharing
These are dashboard-page-local hydrators around UI-state-coupled data. Web
prefers to keep them local-inline rather than pollute the shared registry:

- `dashboard-daily-progress/${userId}`
- `dashboard-achievements/${userId}`
- `dashboard-best-scores/${userId}`
- `dashboard-active-bounties` (page-local; the shared `bounties(userId)`
  already exists for a different concept)
- `dashboard-user-bounties/${userId}`
- `dashboard-active-bet/${userId}` (note: registry has `dailyBet(userId)`;
  different concept — active bet vs daily bet card)
- `dashboard-last-bet/${userId}`
- `dashboard-weekly-chart/${userId}` (rich chart payload; not iOS-equivalent yet)
- `dashboard-elo-rank/${userId}` (single-number rank vs registry's
  `arenaRank` full ELO; iOS may want to consolidate later)
- `social-feed/${userId}`
- `social-nudge/${userId}`
- `social-messages/${userId}/${friendId}`
- `shop-inventory/${userId}`

If iOS later wants any of these shared, file a follow-up — happy to migrate.

---

## 3. Persist skip-list (web localStorage 5–10 MB budget)

`lib/cache/localStorageAdapter.ts` (web-internal) exposes `stripSkippedKeys()`
which `lib/swr-config.ts` applies to the JSON blob right before the shared
adapter writes it. The in-memory Map still caches them — only disk-persist is
skipped.

Skipped prefixes:
- `leaderboard-*` — full leaderboard payloads (~200 rows) revalidate every 30s anyway.
- `social-feed/*` — feed payloads can be large; cheap to re-fetch.
- `dashboard-weekly-chart/*` — rich daily breakdown; ~5KB per user.
- `mastery-session/*` — session content is large and short-lived.

iOS may want a similar skip list applied via its own adapter wrapper; storage
budget on AsyncStorage is bigger but not unlimited and serialisation cost adds
up. The factory's design makes this a pure platform concern — no shared-package
change needed.

---

## 4. Sign-out behaviour (open question)

When the user signs out, we should clear the persisted cache so the next user
on a shared device doesn't see the previous user's data flash. Today neither
web nor iOS wires `adapter.removeItem(SWR_PERSIST_KEY)` into the auth context.

- Web: `lib/auth.tsx` is on the "Do Not Touch" list — admin proposes adding
  a `clearPersistedCache()` call in `logout()` but requires CEO sign-off
  (file-level guard).
- iOS: `vp-ios` to decide where the call fits in the auth flow.

Not a Phase B blocker — per-userId namespacing means the new user's first
fetch overwrites the slot. But on a shared browser, a 1-second flash of the
previous user's data is a real privacy / UX concern. Filing for next pass.

---

## 5. Versioning

`SWR_PERSIST_KEY = "lionade-swr-cache-v1"`. If the cache shape changes
(e.g. a `cacheKeys.*` helper output string changes), bump to `v2` so old
entries are ignored cleanly. Both platforms read/write the same constant
from the shared package — a single version bump invalidates both clients
in lockstep, which is the correct behaviour.

---

*Owners: web side filed by `admin`. iOS side action by `ios-shared-core` /
`vp-ios`. CEO sign-off required before either side changes the canonical
exports.*
