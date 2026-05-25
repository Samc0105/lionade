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

---

## Phase C — iOS audit (2026-05-25, vp-ios)

> Phase C is the migration of `getSubjectStats` from SELECT-500-then-JS-aggregate
> to a Postgres RPC. Admin is shipping the RPC on the web side; this section is
> iOS's pre-migration audit so the moment the RPC lands, the iOS port is a
> mechanical swap.

### Where iOS fetches subject-stats today

**Single hook, single call site type:** `lib/hooks/use-subject-stats.ts`
(82 LOC). iOS does NOT route through `@lionade/core` for this — the hook
calls `supabase.from("quiz_sessions").select(...).limit(200)` directly,
then aggregates in JS exactly like the web's `getSubjectStats` does.

Two consumers:
- `components/SubjectStatsCard.tsx` (Dashboard "BY SUBJECT" panel; 7-day
  window; uses `subject`, `questions`, `accuracyPct`).
- `components/StatOrbs.tsx` (Dashboard stat-orb strip; reads
  `subjectStats.length` for the "Subjects" orb value — count of distinct
  subjects studied in the window).

No other file imports the hook (`grep -rln useSubjectStats` confirms).

### Differences from web's pre-Phase-C path

| Dimension              | Web                                      | iOS                                  |
|------------------------|------------------------------------------|--------------------------------------|
| Window                 | 90 days (lifetime: full history)         | 7 days only                          |
| Row cap                | 500 windowed / 5000 lifetime             | 200 windowed                         |
| Lifetime variant       | YES (`opts.lifetime=true` on profile)    | **NO** — iOS only uses windowed      |
| Output field naming    | `questionsAnswered`, `correctAnswers`,   | `questions`, `correct`, `coins`,     |
|                        | `coinsEarned`                            | + `accuracyPct` (precomputed)        |
| Sort order             | Insertion (record order)                 | `questions DESC` (most-grinded first)|
| Empty bucket label     | Whatever `row.subject` is (no fallback)  | `"Other"` fallback when null/blank   |
| Color/UI shaping       | All in component                         | All in `SubjectStatsCard` component  |

### iOS-specific transforms to PRESERVE post-migration

These run AFTER aggregation and must stay in JS regardless of where the
aggregation happens:
1. `accuracyPct` computation (`round(correct/questions*100)`) — could ship
   inside the RPC, but trivial to keep client-side and avoids forcing a
   shape on web.
2. Sort by `questions DESC` — iOS-specific. Web doesn't sort. RPC should
   NOT impose an order; iOS sorts client-side.
3. `"Other"` fallback for null/blank subject — RPC should return whatever
   it returns; iOS coerces.
4. Window choice — iOS wants **7 days**, web wants **90 days**. The RPC
   needs a window parameter (or two separate windowed/lifetime modes).
   See "Open questions for admin" below.

### Lifetime variant — iOS does NOT use it

iOS has no profile-page "lifetime stats" surface that consumes
`useSubjectStats`. Profile screen (`app/profile.tsx`) shows lifetime
totals from `useUserStats` (`stats.coins`, `stats.xp`) but NOT a subject
breakdown. So `p_lifetime` will always be passed `false` from iOS for
the foreseeable port. If/when iOS adds a lifetime subject breakdown,
the flag is already wired — no client changes needed.

### SWR / cache discipline (Phase A continuity)

`use-subject-stats.ts` is on the Phase A **no-focus-revalidate** side
(not in the keep-list). Mutation invalidation is upstream — when quiz
results post, `lib/cache-invalidation.ts` mutates the cache key. Phase C
must NOT change the cache key string `subject-stats/${userId}` — that
would invalidate every iOS user's persisted cache on first launch
post-build. (Phase B shared adapter persists by key.)

If admin later extends `cacheKeys.subjectStats` to accept a `lifetime`
param (per §2e proposal in this doc), iOS will adopt the helper but
the windowed-only string must stay `subject-stats/${userId}` or
`subject-stats/${userId}/window` — one of the two — and we pick the
same shape as web so the cross-platform string matches even if no
user ever runs both clients.

### Open questions for admin (BLOCKING Phase C iOS migration)

1. **RPC signature** — confirm `get_subject_stats(p_user_id uuid,
   p_lifetime bool)` or different? Or
   `get_subject_stats(p_user_id, p_since_days int)` so iOS passes 7 and
   web passes 90 + a "lifetime override"?
2. **Return-shape field names** — does the RPC return
   `questionsAnswered/correctAnswers/coinsEarned` (web's current JS
   shape) or `total_questions/correct_answers/coins_earned` (the
   underlying column names) or something normalized? iOS will map
   client-side regardless — just need to know.
3. **Gating pattern** — hard-cutover or fallback-to-old-aggregator on
   RPC 404? iOS will mirror whatever web chooses. **Default
   assumption: hard-cutover, deployed in the same window as the
   migration push + iOS build.**
4. **Window semantics** — 7-day vs 90-day. If the RPC bakes in a
   single window, iOS will need a separate path OR the RPC takes a
   `p_since_days` int. Admin's call.

### Migration plan (Phase 2, after admin ships)

Once admin commits the RPC + updates `getSubjectStats` in `lib/db.ts`:
- Update `lib/hooks/use-subject-stats.ts` to call
  `supabase.rpc('get_subject_stats', { p_user_id, p_lifetime: false })`.
- Map RPC return shape to existing `SubjectStat` interface in the hook
  (preserve `questions/correct/coins/accuracyPct` field names so
  consumers in `SubjectStatsCard` + `StatOrbs` are untouched).
- Preserve the `"Other"` fallback + sort + 7-day window expectation.
- Cache key `subject-stats/${userId}` stays — no SWR invalidation.
- iOS-local commit on top of `806eba6`. NO build until Sam says "build it".

### Surprises

- iOS hook was migrated to iOS-local in Phase A (per the JSDoc at top
  of `use-subject-stats.ts`) and explicitly notes "we'll move this to a
  Postgres view + RPC like the web's plan" — Phase C is exactly that
  planned move. Confirms the audit-then-migrate sequencing is correct.
- iOS has its OWN client-side aggregator in `use-weekly-activity.ts`
  (separate hook, also Phase A territory). Per Sam's scope-discipline
  directive, **flagged but NOT migrating in this pass**. If it's also
  slow, that's a Phase D conversation.

*Owner: `vp-ios` → `ios-dev-data` + `ios-platform-bridge`. Awaiting
admin's RPC commit + Phase C handoff before code change.*

---

# Phase C coordination notes — `get_subject_stats` RPC (2026-05-25)

Status: **WEB-SIDE READY 2026-05-25.** Migration `047_subject_stats_rpc.sql`
committed locally on web; NOT yet applied to prod (Sam batches A+B+C push
together). Web's `lib/db.ts:getSubjectStats` now calls the RPC instead of
SELECT-then-JS-aggregate. Cache key + return shape unchanged.

## RPC signature (verbatim — drop into iOS data layer as-is)

```sql
public.get_subject_stats(p_user_id uuid, p_lifetime boolean DEFAULT false)
RETURNS TABLE (
  subject            text,
  "questionsAnswered" integer,
  "correctAnswers"    integer,
  "coinsEarned"       integer
)
LANGUAGE sql STABLE SECURITY INVOKER
```

- `SECURITY INVOKER` → existing `quiz_sessions_owner` RLS policy enforces
  ownership. iOS callers using the user's JWT will get only their own data.
- Return columns are quoted camelCase so the JS/TS shape lands as
  `{ subject, questionsAnswered, correctAnswers, coinsEarned }[]` with zero
  field mapping needed on the client.
- `p_lifetime = false` (default) → trailing 90-day window
- `p_lifetime = true` → all-time aggregation (Profile-page variant)

## Web call-site (mirror in iOS)

```ts
const { data, error } = await supabase.rpc("get_subject_stats", {
  p_user_id: userId,
  p_lifetime: lifetime, // boolean
});
// data: { subject; questionsAnswered; correctAnswers; coinsEarned }[]
```

## iOS recommendation: migrate now (parity), but don't ship until web ships

Recommended approach:

1. `ios-shared-core` adds `subjectStatsAPI.fetch(userId, { lifetime })` to
   the shared package — same shape as the web wrapper above. **Internally
   uses the RPC** — don't keep two paths.
2. `vp-ios` queues this for the same Phase A+B+C push window so the RPC
   is available on prod when the iOS build that consumes it goes out.
3. Until the RPC exists on prod, iOS can either:
   - **Option A (recommended):** stay on the old SELECT-and-aggregate path
     in `subjectStatsAPI` and swap to the RPC in a one-line internal change
     the moment migration 047 lands on prod. Zero user-visible iOS impact
     during the transition.
   - **Option B:** ship the RPC call in iOS dev-client now, test against a
     Supabase branch where migration 047 is applied (Sam to greenlight a
     branch test before merging to prod).

Either option is fine — the contract above is stable. The choice is purely
about iOS release timing relative to web.

## Index coverage (already in place)

Migration 039 added `idx_quiz_sessions_user_completed (user_id, completed_at DESC)`
which the windowed variant uses directly. Lifetime variant also uses the
user_id prefix. No new index is needed for iOS to consume this RPC.

## Performance expectation (web measurement, iOS will be similar)

- Old path (SELECT 500-5000 rows + JS GROUP BY): ~150-300ms (Dashboard) / ~300-600ms (Profile lifetime)
- New path (RPC): ~5-20ms server + <5ms client. ~95-98% network payload reduction.

## Type generation note for both platforms

`@lionade/core/types/supabase.ts` does not yet have the RPC typed because
migration 047 is not on prod. **After Sam pushes A+B+C and the migration
applies to prod**, regenerate types via the Supabase CLI / MCP
`generate_typescript_types` and commit the regenerated `supabase.ts`. Until
then, the RPC call is typed via the inline cast in `lib/db.ts:getSubjectStats`
on web (and should be similarly cast in iOS).

## Open question for `vp-ios`

iOS currently has no Profile-page lifetime aggregation surface
(per IOS_PARITY 2026-05-13: iOS missing Study-DNA, but does it have a
Profile-level subject breakdown?). If iOS only consumes the 90-day variant,
the lifetime branch in `subjectStatsAPI` can be omitted on iOS for now —
it's a no-op cost since the boolean is just a param. Confirm before merging
the iOS API to avoid carrying unused surface area.

## Hotspots flagged but NOT migrated this pass (scope discipline)

While auditing `lib/db.ts` for Phase C, I noted these similar
SELECT-many-then-JS-aggregate patterns. Sam can prioritize a Phase C-extension:

1. **`getBestScores` (lib/db.ts:750)** — SELECT 500 rows, computes max per
   subject in JS. Same pattern, same fix (RPC with `MAX(correct_answers)`
   GROUP BY subject). Probably ~100ms savings on Dashboard.
2. **`getRecentTopics` (lib/db.ts:664)** — already a 2-query design after
   the N+1 batch fix; could be a single RPC with a LATERAL join but the win
   is smaller (~30-50ms).
3. **`getQuizHistory` (similar pattern elsewhere in lib/db.ts)** — pulls 100
   rows for Profile. Pagination, not aggregation — leave as-is; raw rows
   are needed for the history list.

Migration 047 is intentionally narrow. Sam to greenlight a Phase C.2 if the
win on `getBestScores` is worth the second migration.

---

*Phase C web owners: `dev-database` (migration), `dev-backend` (db.ts rewrite),
`security-auditor` (RLS / SECURITY INVOKER review), `dev-performance` (speedup
estimate), `quality-qa-tester` (shape parity), `quality-code-reviewer` (sign-off).
iOS owners: `ios-shared-core` (subjectStatsAPI wrapper), `vp-ios` (release timing).*

---

## Phase C.1 follow-up request — `p_window_days` server-side param (2026-05-25, vp-ios)

**Status:** REQUESTED. Awaiting admin's next-cycle pickup.

### Why iOS is filing this

Admin's Phase C answer to the iOS audit's question #4 (window semantics) recommended: *"iOS calls with `p_lifetime=false` and filters client-side to 7 days."* On inspection, **this workaround is not viable on the current RPC return shape**:

- `get_subject_stats(p_user_id, p_lifetime=false)` returns rows **already aggregated by subject** across the 90-day window — `(subject, "questionsAnswered", "correctAnswers", "coinsEarned")`.
- There is no `completed_at` on the returned rows. Client-side has no signal to distinguish a subject played 6 days ago from one played 60 days ago — the SUMs already collapsed both into a single row.
- iOS UX (`SubjectStatsCard` literal "Last 7 days" label + `StatOrbs` distinct-subjects-this-week orb) is load-bearing on 7-day semantics. Swallowing 90 days silently is a UX regression.

So iOS cannot do the workaround; it needs server-side support.

### Proposed signature

```sql
CREATE OR REPLACE FUNCTION public.get_subject_stats(
  p_user_id uuid,
  p_lifetime boolean DEFAULT false,
  p_window_days integer DEFAULT 90
)
RETURNS TABLE (
  subject text,
  "questionsAnswered" integer,
  "correctAnswers" integer,
  "coinsEarned" integer
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    qs.subject,
    COALESCE(SUM(qs.total_questions), 0)::integer AS "questionsAnswered",
    COALESCE(SUM(qs.correct_answers), 0)::integer AS "correctAnswers",
    COALESCE(SUM(qs.coins_earned),    0)::integer AS "coinsEarned"
  FROM public.quiz_sessions qs
  WHERE qs.user_id = p_user_id
    AND (
      p_lifetime
      OR qs.completed_at >= (now() - make_interval(days => p_window_days))
    )
  GROUP BY qs.subject;
$$;
```

### Design notes

- **Backward-compatible.** `p_window_days` defaults to `90`, so web's existing `getSubjectStats(userId, { lifetime })` call works unchanged.
- iOS calls with `p_window_days: 7` for the Dashboard "Last 7 days" panel.
- Index coverage from migration 039 (`idx_quiz_sessions_user_completed (user_id, completed_at DESC)`) still applies — any trailing-window predicate `completed_at >= now() - interval` is a prefix scan.
- `make_interval(days => p_window_days)` is the safe idiom for parameterized intervals — avoids string concatenation / SQL injection seams.
- Same `SECURITY INVOKER` + `REVOKE FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role` posture as 047.
- Idempotent via `CREATE OR REPLACE FUNCTION` (replacing the 3-arg signature; the 2-arg signature from 047 is left in place by default — Postgres allows function overloading. If admin prefers to retire the 2-arg form, add `DROP FUNCTION public.get_subject_stats(uuid, boolean);` before the CREATE).

### Web migration choice

Two paths admin can pick:

1. **Add the 3-arg signature alongside the 2-arg one** (Postgres overloading; minimal blast radius — existing web call site unaffected). Cleanest.
2. **Replace the 2-arg signature with the 3-arg one** (single canonical function; web's `getSubjectStats` wrapper passes `p_window_days: undefined` and gets the 90 default). One-line diff in `lib/db.ts`.

vp-ios is agnostic — both work for iOS. Pick whichever fits the web team's policy on function-signature versioning.

### Owner

`dev-database` (migration design) + `dev-backend` (no web call-site change needed if admin picks option 1; one-line param add if option 2) + `security-auditor` (RLS / `search_path` review — should be a rubber stamp; same posture as 047). `quality-qa-tester` should add a 7-day variant case to the existing `get_subject_stats` parity table.

### iOS-side wait state

iOS hook `lib/hooks/use-subject-stats.ts` stays on the existing SELECT-and-aggregate path until this migration lands on prod. When it does:

- iOS swap is a 4-line edit: `supabase.rpc('get_subject_stats', { p_user_id: userId, p_lifetime: false, p_window_days: 7 })`.
- Field mapping: rename `questionsAnswered → questions`, `correctAnswers → correct`, `coinsEarned → coins` in the hook's transform step. Consumers in `SubjectStatsCard` + `StatOrbs` stay untouched.
- Cache key `subject-stats/${userId}` stays byte-identical.
- Estimated speedup matches admin's web measurement: ~150ms → ~10ms on Dashboard.

---

*Owner: web `dev-database` next cycle. Blocking iOS Phase C code migration.*
