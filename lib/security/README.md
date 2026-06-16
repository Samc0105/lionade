# Security Monitoring (SOC) — L7 request telemetry, threat detection, IP denylist

The application-layer security operations subsystem for Lionade web. It gives
the `/admin/security` console an honest view of what the app itself sees:
live presence, request volume, classified threat actors, and an admin-curated
IP denylist enforced at the edge.

This is an **L7-only** view. It complements, it does not replace, Vercel's
edge firewall. Read "Honest scope" below before trusting it for anything.

---

## At a glance

| Piece | Runtime | File |
|---|---|---|
| Edge signatures (pure) | Edge | `lib/security/signatures.ts` |
| Edge aggregation + denylist enforcement | Edge | `middleware.ts` |
| Telemetry ingest (holds service role) | Node | `app/api/internal/telemetry/route.ts` |
| Denylist read (holds service role) | Node | `app/api/internal/denylist/route.ts` |
| Route-handler auth-probe emitter | Node | `lib/admin-auth.ts` (`recordSecurityEvent`) |
| Admin overview API | Node | `app/api/admin/security/overview/route.ts` |
| Admin threats API | Node | `app/api/admin/security/threats/route.ts` |
| Admin denylist list / block | Node | `app/api/admin/security/denylist/route.ts` |
| Admin denylist unblock | Node | `app/api/admin/security/denylist/remove/route.ts` |
| SOC alert cron (every 10 min) | Node | `app/api/cron/security-alerts/route.ts` |
| Auto-maintenance evaluator (every 5 min) | Node | `app/api/cron/feature-health/route.ts` |
| Console UI | Client | `app/admin/security/page.tsx` |
| Tables + RPC | Postgres | `lib/migrations/20260616140000_security_monitoring.sql` |
| Alert dedup ledger | Postgres | `lib/migrations/20260616160000_feature_flags_v2.sql` (`security_alerts_sent`) |

---

## Architecture

```
                       Vercel edge (absorbs L3/L4 volumetric DDoS)
                                     │
                          incoming request reaches the app
                                     │
        ┌────────────────────────────────────────────────────────┐
        │  EDGE RUNTIME  (middleware.ts + lib/security/signatures) │
        │  - NO service role, NO supabaseAdmin, NO node crypto/fs  │
        │  - denylist enforce (serves an in-memory Set on a TTL)   │
        │  - rate-limit decision (unchanged)                       │
        │  - aggregate in memory:                                  │
        │      rollupBuckets  (minute x key_prefix x decision)     │
        │      ipCounts       (bounded top-offender map, cap 200)  │
        │      pendingEvents  (bounded event queue, cap 100)       │
        │  - flush + denylist refresh run inside event.waitUntil   │
        └───────────────────────────┬──────────────────────────────┘
                 plain fetch, x-internal-secret header, AbortSignal 5s
                                     │
        ┌────────────────────────────────────────────────────────┐
        │  NODE RUNTIME  (internal routes — HOLD the service role) │
        │  POST /api/internal/telemetry  → RPC + bulk insert       │
        │  GET  /api/internal/denylist   → { ips: string[] }       │
        └───────────────────────────┬──────────────────────────────┘
                                     │  supabaseAdmin (service role)
        ┌────────────────────────────────────────────────────────┐
        │  SUPABASE                                                │
        │  request_telemetry_rollup  (IP-free minute aggregate)    │
        │  security_events           (bounded per-IP offenders)    │
        │  ip_denylist               (admin-curated block list)    │
        │  ingest_telemetry_rollup(p_rows)  ATOMIC increment upsert │
        └────────────────────────────────────────────────────────┘
                                     ▲
                 requireRole(admin) ──┘  admin read APIs + the console UI
```

### The edge invariant (the load-bearing rule)

`middleware.ts` and `lib/security/signatures.ts` run on the **Edge runtime**.
They must never import `supabaseAdmin`, the service role, node `crypto`/`fs`, or
anything node-only. `signatures.ts` is a **pure** module: string and regex logic
over the incoming request, no IO of any kind.

The edge therefore cannot read or write Supabase directly. **That is by design.**
All database work is delegated to two **node-runtime** internal routes
(`export const runtime = "nodejs"`) that hold the service role. The middleware
reaches them only over plain `fetch`, authenticated by a shared
`x-internal-secret` header. This is the single reason the service role never
ends up in the edge bundle: if the edge could write Supabase, the service key
would have to ship to every edge region.

### Flow of a single request

1. Edge: if the IP is in the in-memory denylist `Set`, reject with a generic
   `403` immediately. Record the `denylist` decision in the rollup plus a
   `denylist_hit` event. No rate-limit state is touched.
2. Edge: run the existing rate-limit loop (first match wins). The
   allow / block decision and the `429` body are byte-for-byte unchanged from
   before telemetry existed; the matched `keyPrefix` and blocked flag are
   captured only to feed telemetry.
3. Edge: aggregate in memory. Bump the minute-bucketed rollup counter, bump the
   bounded `ipCounts` map (twice if the request tripped a `429`, so throttle-
   trippers outrank merely chatty IPs), and push a discrete event if the path
   matches a scanner/enumeration signature or the UA is a scanner/bot on an API
   surface.
4. Edge: `maybeFlush` schedules a flush via `event.waitUntil` at most once per
   `FLUSH_INTERVAL_MS` (10s). All network IO is fire-and-forget; **request
   latency is never blocked on it.**
5. Node ingest route: validates the `x-internal-secret` (constant-time),
   coerces the body, then calls the `ingest_telemetry_rollup` RPC for the
   counters and bulk-inserts the events. Returns `204` on success, generic
   `500` on failure (real detail to `console.error` only).

---

## Why it is DDoS-safe

The whole subsystem is built so that **DB write volume is decoupled from
request volume.** A flood that 100x's traffic must not 100x the database load,
or the telemetry would itself become the outage.

1. **Flushes are time-gated, not request-gated.** `maybeFlush` only schedules
   work when `now - lastFlushAt > FLUSH_INTERVAL_MS`, and it advances
   `lastFlushAt` synchronously before the async work starts, so concurrent
   requests cannot each schedule a duplicate flush. The result: **at most ~6
   ingest POSTs per minute per edge instance**, regardless of whether that
   instance saw 10 requests or 10 million. Total DB write rate scales with
   `edge_instances x flushes_per_minute`, never with requests.

2. **The rollup table is IP-free and low cardinality.** Its only dimensions are
   `(bucket_minute x key_prefix x decision)`. `key_prefix` is one of ~45
   rate-limit prefixes or a coarse `pathGroup()` bucket (`api:<family>`,
   `admin`, `auth`, `page`, `static`, `well-known`, `internal`). It can never
   hold a user id, slug, or per-IP row. Bounded row growth: minutes-elapsed x
   ~45 prefixes x 3 decisions.

3. **Per-IP data is bounded to top-N offenders + discrete probes.** The
   `ipCounts` map is capped at 200 entries and evicts its lowest-count entry
   when over cap, so an IP-rotation attack (millions of distinct source IPs)
   cannot explode memory or rows: the loudest offenders survive, the long tail
   is dropped. At flush time only IPs over `OFFENDER_FLOOD_THRESHOLD` (120 in a
   ~10s window) are escalated to `flood` events, and only the loudest
   `OFFENDER_TOP_N` (20) of those are emitted. The `pendingEvents` queue is
   capped at 100 and drops on the floor when full.

4. **The atomic-increment RPC prevents lost writes.** PostgREST's own upsert
   *overwrites* the conflicting row, which would lose every concurrent flush
   landing in the same minute bucket. `ingest_telemetry_rollup` does
   `ON CONFLICT ... DO UPDATE SET count = stored + excluded` instead, so two
   instances flushing the same `(minute, prefix, decision)` add rather than
   clobber. This is the entire reason the RPC exists.

5. **Telemetry never affects request handling.** Every flush, denylist refresh,
   and event push is best-effort. A failed ingest drops one window of counts and
   is logged to `console.error` only; it never changes a status code or adds
   latency. `fetch` calls carry a 5s `AbortSignal.timeout` so a hung node route
   cannot pin an edge connection open.

6. **The whole feature is dormant unless configured.** If
   `INTERNAL_TELEMETRY_SECRET` is unset, the middleware skips denylist
   enforcement and all aggregation entirely, and the internal routes return
   `503`. Zero overhead until you opt in.

---

## What it detects

Detection lives in `lib/security/signatures.ts` (edge) and `lib/admin-auth.ts`
(node route handlers). Signatures are deliberately conservative: we would rather
miss a clever probe than block a real student.

| Category | Source | Trigger |
|---|---|---|
| `scanner` | edge | `matchBadPath()` hit on a secret/config-exfil or CMS-exploit path (`/.env`, `/.git`, `/wp-login.php`, `/xmlrpc.php`, `/vendor/`, `/.aws`, `/.ssh`, `/config.json`, `/actuator`, `/.DS_Store`, ...), or a known offensive-security tool UA (`sqlmap`, `nikto`, `nmap`, `masscan`, `zgrab`, `nuclei`, `wpscan`, ...) on an API surface. |
| `enumeration` | edge | `matchBadPath()` hit on an admin-panel / DB-tool discovery path (`/phpmyadmin`, `/adminer.php`, `/administrator`, `/manager/html`, `/.well-known/openid-configuration`, ...). |
| `bot` | edge | A non-browser HTTP client (`curl/`, `python-requests`, `go-http-client`, `okhttp`, `scrapy`, empty/missing UA, ...) hitting an `/api/` surface. Severity is higher when the UA is scanner tooling vs a bare HTTP library. |
| `flood` | edge | An IP exceeding `OFFENDER_FLOOD_THRESHOLD` requests in a flush window; only the top 20 such offenders per window are emitted. Severity escalates at 4x the threshold. |
| `denylist_hit` | edge | A request from an IP currently on the denylist (the `403` path). |
| `admin_probe` | node | An authenticated user hitting an `/api/admin/*` route they lack the role for. Emitted fire-and-forget by `requireRole()` in `lib/admin-auth.ts` on the 403 branch. This is a signal the edge structurally cannot see, because the role decision happens inside the node handler. |
| `bruteforce` | (reserved) | A defined category and scored weight, but no current emitter. Auth brute force is presently handled by the strict `auth-login` rate-limit bucket in `middleware.ts` (5 / 15 min), which surfaces as `block` decisions and `flood` events rather than a dedicated `bruteforce` row. |
| `auth_failure` | (reserved) | A defined category, validator entry, scored weight, and UI chip exist, but no handler emits it today. Wire it from a node route's failed-login branch via `recordSecurityEvent()` if/when per-IP login-failure tracking is added. |

### Benign exclusions (do not flag)

`signatures.ts` is explicit about what must pass:

- `/.well-known/*` is legitimate (security.txt, ACME http-01,
  apple-app-site-association, assetlinks, change-password) and is **not** a bad
  path. The single exception is the exact `/.well-known/openid-configuration`
  discovery probe.
- Legit crawlers (`googlebot`, `bingbot`, `applebot`, `slackbot`, `gptbot`,
  `claudebot`, Stripe's webhook UA, uptime monitors, ...) are classified by
  `isLegitCrawler()` and never treated as suspicious, even if their UA happens
  to brush a generic token.
- Prefix matching respects path-segment boundaries: `/wp-admin` matches
  `/wp-admin` and `/wp-admin/...` but not `/wp-administrative-x`.

---

## IP denylist enforcement loop

The denylist is admin-curated and enforced at the edge on a 60s TTL cache.

1. **Admin blocks an IP** via the console (`POST /api/admin/security/denylist`,
   or "Block" on a threat-feed row). The node route validates the IP shape,
   upserts `ip_denylist` with `active = true`, and writes an audit row with verb
   `security_ip_block`. Unblock (`POST /api/admin/security/denylist/remove`)
   sets `active = false` (the row is kept for history and re-block) and audits
   `security_ip_unblock`. Unblock is idempotent: unblocking a never-blocked IP
   is a no-op success.
2. **The edge refreshes its cache.** When `now - lastDenylistFetchAt >
   DENYLIST_TTL_MS` (60s) and no refresh is already in flight, the middleware
   schedules `refreshDenylist()` via `event.waitUntil`. It fetches
   `GET /api/internal/denylist`, which returns `{ ips: string[] }` of rows that
   are `active = true AND (expires_at IS NULL OR expires_at > now())`.
3. **Serve stale, never block on the fetch.** The current request always uses
   the in-memory `Set` as it stands. A network failure during refresh keeps the
   last good `Set` and logs to `console.error` only. **Worst-case enforcement
   latency for a new block is one TTL (~60s).**
4. **Per-instance cache.** Each edge instance holds its own `Set` and refreshes
   independently, so a fresh block propagates as instances cross their TTL, not
   instantly across the fleet.

The `/remove` sub-route exists instead of `DELETE /[ip]` on purpose: an IP
(especially IPv6 with `:`, or a CIDR with `/`) does not round-trip cleanly
through a URL path segment, so the IP travels in the JSON body.

---

## SOC alerts (push, not just pull)

The console is a *pull* surface: it shows what the telemetry sees only while
someone has it open. `app/api/cron/security-alerts/route.ts` adds a *push* path
so an attack does not sit unseen until someone happens to look. It is a **Vercel
cron that runs every 10 minutes** (`*/10 * * * *` in `vercel.json`), reads the
same telemetry tables, and emails `support@` (via `SUPPORT_EMAIL`) when one of
two detectors trips. It is a pure read-and-email job: it **never mutates app
state, never blocks a request path, and never touches the feature-flag tables.**

### The two detectors

1. **High-threat IP.** Sums `security_events.count` per IP over the last 60
   minutes, counting only the serious categories `scanner`, `bruteforce`,
   `admin_probe`, and `enumeration` (the tame `bot` / `flood` / `auth_failure` /
   `denylist_hit` signals are deliberately excluded so a noisy-but-benign
   crawler does not page anyone). An IP whose summed count clears
   `THREAT_MIN_TOTAL` (20) is alerted. Row scan is bounded by
   `THREAT_MAX_EVENTS_SCANNED` (5000); PostgREST cannot `GROUP BY`, so the
   per-IP fold happens in JS over that bounded set.
2. **Traffic spike.** From the IP-free `request_telemetry_rollup`, sums total
   requests per minute over a ~31-minute trailing window, ignores the current
   (still-filling) minute, and flags the newest *complete* minute when it clears
   an **absolute floor** (`SPIKE_MIN_TOTAL`, 200) **AND** is at least
   `SPIKE_MULTIPLE` (5x) the trailing median of the other minutes. Both guards
   together stop low-traffic noise (a 1 -> 6 blip) from paging. When the
   baseline median is 0, only the absolute floor applies. Row scan is bounded by
   `SPIKE_MAX_ROWS_SCANNED` (5000).

Both detectors run on every pass via `Promise.all`, each independently
**fail-open**: a read error is logged generically and that detector contributes
zero alerts while the other still runs.

### Dedup so a sustained attack does not re-email every 10 minutes

Each potential alert has a `dedup_key`, checked against the
`public.security_alerts_sent` ledger (created in
`lib/migrations/20260616160000_feature_flags_v2.sql`) **before** sending and
inserted only **after** a confirmed send:

- high-threat IP -> `threat:<ip>:<UTC date+hour>` (so a given IP pages at most
  once per hour),
- traffic spike -> `spike:<spiking minute ISO>` (so a given minute pages once).

`alreadySent()` **fails CLOSED** on a read error (treats the key as already
sent, skipping the email): a missed alert is recoverable, an email storm to
`support@` is not. `markSent()` failing is non-fatal — at worst the same alert
re-sends on the next pass, which is the safe direction. The cron writes only to
`security_alerts_sent`; it produces **no** `admin_audit_log` rows because it is
an automated job, not an admin action.

### Auth, email config, and secret handling

- **Auth:** header-only `Bearer CRON_SECRET`, compared in constant time
  (`timingSafeEqual`, length-checked first), matching the sibling crons. Unset
  secret fails **closed** with a generic `500`; a mismatch returns `401`. The
  secret is never logged or echoed.
- **Email config gate:** if `RESEND_API_KEY` or `EMAIL_FROM` is unset the job
  still runs the detectors but **skips sending silently** (returns `{ ok: true }`
  with zero sends) rather than 500-ing. Email failures are logged generically;
  bodies are dash-free, name the concrete signal, carry **no secrets**, and link
  to `/admin/security`.
- **Last-resort guard:** the whole `GET` body is wrapped so it never throws out
  of the cron; an unexpected error logs generically and still returns
  `{ ok: true }`. It also writes a `putCronHeartbeat("security-alerts")` for the
  watchdog.

### Honest about the same lossy limit

These alerts inherit the **in-memory aggregation is lossy** caveat below
verbatim. `security_events` and `request_telemetry_rollup` are summed across
short-lived per-instance edge buffers via the atomic RPC, so both detectors run
on a **strong directional signal, not exact accounting**. A flood that recycles
its edge instance before a flush loses that partial window, so the spike
detector can under-count a real burst, and the threat sum is approximate. The
thresholds (20 offender events, 200 req/min floor + 5x median) are set
deliberately high so the noise floor does not page; the trade is that a
small-but-genuine probe under those bounds will not alert. This is a heads-up
layer on top of an approximate signal, not a precise IDS.

---

## Auto-maintenance evaluator (sibling cron)

A second push job lives next to the SOC alert cron but belongs to the **feature
kill-switch**, not this SOC subsystem: `app/api/cron/feature-health/route.ts`, a
Vercel cron on `*/5 * * * *`. It reads the `feature_health_events` 5xx firehose
(written fire-and-forget by `recordFeatureError` in guarded routes' 500 paths),
and when a feature clears 10 errors in 10 minutes it auto-flips that LIVE
feature into a self-expiring 20-minute `warning` (usable + banner), opens an
auto incident, and emails `support@` once. It recovers its own flags when the
errors subside. It sets ONLY `warning`, **never `maintenance`**, and never
touches a human override. It shares the same `Bearer CRON_SECRET` auth,
fail-open contract, and Resend email-config gate as the SOC alert cron, and it
emails into `support@` the same way, which is why it sits in this table.

It is **not** a security detector and produces no `security_events`. Its full
contract, the incidents timeline, and the honest "error-count not a true rate"
caveat live in **`lib/features/README.md`** (the kill-switch doc). Cross-listed
here only because it is a `support@`-paging cron that operators will look for
alongside the SOC alerts.

## Honest scope

**This is L7 (application-layer) monitoring only.** It sees requests that
already reached the Next.js app. It does **not** see, and cannot stop,
volumetric L3/L4 network DDoS: Vercel's edge absorbs that upstream before any
request reaches the middleware. The console banner links out to Vercel
Firewall, Observability, and Analytics for the network-layer picture, and the
"elevated traffic" note on the live chart is deliberately worded as an
application-layer observation, **not** a DDoS verdict.

What this subsystem is good for: spotting and blocking scanners, config-exfil
probes, admin-panel enumeration, bot scraping, brute-force-shaped bursts, and
specific abusive IPs. It is a complement to Vercel Firewall, not a replacement.

### Known limitation: in-memory aggregation is lossy

Vercel edge instances are short-lived and there are many of them. The
`rollupBuckets`, `ipCounts`, and `pendingEvents` buffers live in per-instance
memory and are cleared on every flush. Consequences:

- A buffer that has not flushed yet when its instance is recycled loses that
  partial window of counts.
- Counts are summed across instances via the atomic RPC, so totals are a
  **strong directional signal, not exact accounting.** Treat the traffic chart
  and offender counts as "approximately right and trend-accurate", not as a
  ledger.
- Denylist enforcement is per-instance and TTL-bounded (see above), so block
  propagation is eventually-consistent, not instant.

**Upgrade path (already noted in `middleware.ts`):** swap the in-memory rate
limiter and aggregation for Upstash Redis
(`@upstash/ratelimit` + `@upstash/redis`, reading `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`). That gives exact cross-instance accounting and
instant fleet-wide rate-limit + denylist state. It is intentionally **not**
wired today (no new npm packages, no per-request external IO).

---

## Setup

The feature is dormant by default. To enable it:

1. **Run the migrations manually** (Sam, via the Supabase SQL editor), both
   idempotent and safe to re-run:
   - `lib/migrations/20260616140000_security_monitoring.sql` — the three
     telemetry tables, the `ingest_telemetry_rollup` RPC, and admin-only RLS. It
     references `public.current_app_role()` from migration 057 and does not
     redefine it. The read APIs tolerate the tables being absent until it runs
     (the console shows a "run the migration" note).
   - `lib/migrations/20260616160000_feature_flags_v2.sql` — adds
     `security_alerts_sent`, the dedup ledger the SOC alert cron needs. The cron
     fails safe if it is absent: `alreadySent()` fails closed on the read error
     and the alert is skipped rather than re-sent. (This migration is shared
     with the feature kill-switch; see `lib/features/README.md`.)
2. **Set `INTERNAL_TELEMETRY_SECRET`** in Vercel for **Production and Preview**.
   Use a long random value. This single secret authenticates the middleware to
   both internal node routes.
   - It is read **at call time** (`process.env.INTERNAL_TELEMETRY_SECRET`), so
     the feature can be toggled by setting/clearing the env var without code
     changes. The middleware reads it as a server-side edge secret.
   - It is **not** `NEXT_PUBLIC_*`, so it is never shipped to the browser.
   - The **service role key must never** appear in middleware or any edge file.
     Only the two node-runtime internal routes hold `supabaseAdmin`.
3. Redeploy. With the secret set, the middleware begins enforcing the denylist
   and flushing telemetry; the `/admin/security` console (admin-gated) starts
   populating.
4. **For the SOC alert cron** (optional, but recommended once telemetry is on):
   - `CRON_SECRET` must be set (shared with the other crons) so Vercel can
     authenticate the every-10-min invocation. Unset fails closed.
   - `RESEND_API_KEY` + `EMAIL_FROM` must be set for emails to actually send;
     without them the cron runs the detectors and skips sending silently. Alerts
     go to `SUPPORT_EMAIL` (`support@getlionade.com`).

### Secret handling rules honored here

- The `x-internal-secret` is compared in **constant time** (`timingSafeEqual`,
  length-checked first since lengths are not secret).
- Env unset → `503`; mismatch or wrong length → `401`.
- Secrets are **never logged or echoed.** Response bodies are generic; real
  detail goes only to `console.error("[route-tag]", msg)`.

---

## RLS, audit, and the type gap

- **RLS** is enabled on all three telemetry tables plus `security_alerts_sent`.
  Read is admin-only (`public.current_app_role() = 'admin'` `FOR SELECT`);
  `anon` is fully revoked; the service role bypasses RLS for writes. There are
  no client INSERT/UPDATE/DELETE policies, because every write path holds the
  service role from a node route (the alert cron included).
- **Audit verbs** introduced by this subsystem: `security_ip_block` and
  `security_ip_unblock`, written via `writeTeamAudit()` after the mutation
  succeeds. `admin_audit_log.action` is free text; these are documented in the
  migration header, not constrained by a check. The alert cron writes **no**
  audit rows (it is an automated job, not an admin action) — only the
  `security_alerts_sent` dedup ledger.
- **Documented Supabase-type gap:** `supabaseAdmin` is constructed without a
  generated `Database` generic, so `.rpc("ingest_telemetry_rollup", ...)` and
  `.from("security_events" | "ip_denylist" | "request_telemetry_rollup" |
  "security_alerts_sent")` selects/inserts are untyped. Every such call site
  carries a `NOTE (documented Supabase-type gap)` comment, and the column shapes
  are pinned to match the migrations exactly. This is the only place
  `any`-shaped Supabase access is accepted in the subsystem.

---

## Threat model

| Threat | Reaches this subsystem? | Mitigation | Residual risk |
|---|---|---|---|
| Volumetric L3/L4 network DDoS | No | Absorbed by Vercel edge upstream | Out of scope here; monitor via Vercel Observability |
| L7 request flood from one IP | Yes | Rate-limit `block` + bounded `flood` events; admin can denylist | Block propagates over a ~60s TTL per instance |
| Distributed L7 flood (IP rotation) | Yes | Time-gated flushes cap DB writes; `ipCounts` cap 200 + eviction caps rows/memory | Long-tail offenders dropped; counts are a signal, not exact |
| Vuln scanner / config-exfil probes | Yes | `matchBadPath()` classifies as `scanner`/`enumeration`; surfaced in threat feed; admin denylist | Conservative signatures may miss novel probe paths |
| Scraper / bot using raw HTTP client | Yes | Suspicious-UA classification as `bot` on `/api/` surfaces | Legit crawlers intentionally excluded; spoofed browser UA passes |
| Admin-surface probing by an authenticated user | Yes | `requireRole()` 403 + fire-and-forget `admin_probe` event | None beyond the lossy-aggregation caveat |
| Auth brute force | Partial | Strict `auth-login` rate-limit bucket (5/15min) → `block`/`flood` | No dedicated `bruteforce`/`auth_failure` emitter yet (reserved) |
| Forged internal ingest/denylist call | Yes | `x-internal-secret` constant-time guard; unset → 503, mismatch → 401 | Secret compromise would allow spoofed telemetry; rotate via env |
| Service-role key leaking to the browser/edge | N/A | Edge invariant: service role lives only in node internal routes; secret is non-public env | Enforced by code review of edge imports |
| Stripe webhook breakage from middleware | N/A | `/api/stripe/webhook` short-circuits before any telemetry/rate-limit logic | None |
| Telemetry outage cascading into an app outage | Yes | All telemetry is best-effort, fire-and-forget, 5s-timeout, never throws to the caller | A telemetry failure silently drops one window of data |
| Attack unseen between console checks | Yes | SOC alert cron (every 10 min) emails `support@` on a high-threat IP or traffic spike, deduped via `security_alerts_sent` | Runs on the same lossy aggregate; thresholds set high so a small probe under them will not page |
| SOC alert system spamming support@ | Yes | Dedup keyed per IP+hour / per minute; `alreadySent()` fails closed on read error; email-config-off skips silently | A dedup-insert failure can re-send one alert next pass (bounded) |
