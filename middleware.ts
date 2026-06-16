import { NextResponse } from "next/server";
import type { NextRequest, NextFetchEvent } from "next/server";
import {
  matchBadPath,
  isSuspiciousUserAgent,
  isScannerUserAgent,
  pathGroup,
  type TelemetryRollupRow,
  type SecurityEventInput,
} from "@/lib/security/signatures";

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting + security headers middleware
//
// In-memory rate limiter — works fine for single-instance dev/single-region.
// For Vercel multi-region production, swap for Upstash Redis:
//   npm install @upstash/ratelimit @upstash/redis
//   Then read UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN from env.
//
// THE EDGE INVARIANT: this file runs on the Edge runtime. It must NOT import
// supabaseAdmin, the service role, node 'crypto'/'fs', or anything node-only.
// All Supabase work (telemetry ingest + denylist read) is delegated to the two
// internal NODE routes, reached over plain fetch through event.waitUntil so the
// request path is never blocked on network IO.
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitRecord>();
// Hard cap so a distributed flood (many distinct source IPs) cannot bloat the
// Map between purge cycles. When over cap we evict the single soonest-to-expire
// record (it is closest to being purged anyway), keeping the store bounded
// regardless of incoming IP cardinality. maybePurge() still sweeps expired keys.
const STORE_CAP = 20_000;

function evictOldestRecord(): void {
  let oldestKey: string | null = null;
  let oldestResetAt = Infinity;
  store.forEach((rec, key) => {
    if (rec.resetAt < oldestResetAt) {
      oldestResetAt = rec.resetAt;
      oldestKey = key;
    }
  });
  if (oldestKey !== null) store.delete(oldestKey);
}

function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const record = store.get(key);
  if (!record || now > record.resetAt) {
    if (!record && store.size >= STORE_CAP) evictOldestRecord();
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (record.count >= max) return false;
  record.count++;
  return true;
}

// Periodic cleanup so the Map doesn't grow unbounded
let purgeCounter = 0;
function maybePurge() {
  if (++purgeCounter < 500) return;
  purgeCounter = 0;
  const now = Date.now();
  store.forEach((rec, key) => {
    if (now > rec.resetAt) store.delete(key);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DDoS-safe telemetry + IP-denylist enforcement (feature-gated, fire-and-forget)
//
// Everything below is dormant unless INTERNAL_TELEMETRY_SECRET is set. When it
// is, the middleware:
//   1. Enforces an IP denylist refreshed off a 60s TTL (serve stale during
//      refresh, never block the request on the fetch).
//   2. Aggregates per-minute rollup counters (low cardinality: minute x prefix
//      x decision) plus a BOUNDED top-offender map and a BOUNDED event queue,
//      then flushes to the node ingest route at most ~6 times/min/instance no
//      matter how much traffic arrives. This is the property that keeps the DB
//      write rate flat under a flood.
//
// All network IO runs through event.waitUntil so request latency is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

type Decision = "allow" | "block" | "denylist";

// --- IP denylist cache -------------------------------------------------------
let denylistSet = new Set<string>();
let lastDenylistFetchAt = 0;
let denylistRefreshInFlight = false;
const DENYLIST_TTL_MS = 60 * 1000;

// --- Rollup + offender + event buffers ---------------------------------------
// rollupBuckets key: `${minuteISO}|${keyPrefix}|${decision}` -> count
const rollupBuckets = new Map<string, number>();
// ipCounts: bounded top-offender tracker (request volume per IP this window)
const ipCounts = new Map<string, number>();
const IP_COUNTS_CAP = 200;
// pendingEvents: bounded discrete security events (scanner/bot/probe hits)
const pendingEvents: SecurityEventInput[] = [];
const PENDING_EVENTS_CAP = 100;
let lastFlushAt = 0;
const FLUSH_INTERVAL_MS = 10 * 1000;
// Offender -> 'flood' event threshold: only IPs over this count in a flush
// window are escalated, and only the loudest ~20 are emitted.
const OFFENDER_FLOOD_THRESHOLD = 120;
const OFFENDER_TOP_N = 20;

function internalSecret(): string {
  // Read at call time so the feature can be enabled without a redeploy of the
  // edge bundle picking up a stale empty value. Never logged, never shipped to
  // the browser (not NEXT_PUBLIC_).
  return process.env.INTERNAL_TELEMETRY_SECRET ?? "";
}

function minuteIso(now: number): string {
  // Floor to the minute so all counts in a wall-clock minute share a bucket.
  return new Date(Math.floor(now / 60000) * 60000).toISOString();
}

function bumpRollup(minute: string, keyPrefix: string, decision: Decision): void {
  const key = `${minute}|${keyPrefix}|${decision}`;
  rollupBuckets.set(key, (rollupBuckets.get(key) ?? 0) + 1);
}

function bumpIp(ip: string): void {
  const next = (ipCounts.get(ip) ?? 0) + 1;
  ipCounts.set(ip, next);
  // Evict the lowest-count entry when over cap so the map stays bounded under a
  // distributed flood (many distinct source IPs). The loudest offenders survive.
  if (ipCounts.size > IP_COUNTS_CAP) {
    let minIp: string | null = null;
    let minCount = Infinity;
    ipCounts.forEach((v, k) => {
      if (v < minCount) {
        minCount = v;
        minIp = k;
      }
    });
    if (minIp !== null && minIp !== ip) ipCounts.delete(minIp);
  }
}

function pushEvent(evt: SecurityEventInput): void {
  // Drop on the floor when full: an event queue that grows unbounded under a
  // flood would defeat the whole DDoS-safe design.
  if (pendingEvents.length >= PENDING_EVENTS_CAP) return;
  pendingEvents.push(evt);
}

/**
 * Refresh the denylist from the internal node route on a TTL. Fire-and-forget:
 * the current request always serves the (possibly stale) in-memory Set. Runs
 * inside event.waitUntil so it never adds latency.
 */
async function refreshDenylist(origin: string, secret: string): Promise<void> {
  if (denylistRefreshInFlight) return;
  denylistRefreshInFlight = true;
  try {
    const res = await fetch(`${origin}/api/internal/denylist`, {
      method: "GET",
      headers: { "x-internal-secret": secret },
      // Bounded so a hung node route can't pin an edge connection open.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const body: unknown = await res.json();
    if (
      body !== null &&
      typeof body === "object" &&
      Array.isArray((body as { ips?: unknown }).ips)
    ) {
      const ips = (body as { ips: unknown[] }).ips.filter(
        (x): x is string => typeof x === "string",
      );
      denylistSet = new Set(ips);
      lastDenylistFetchAt = Date.now();
    }
  } catch (err) {
    // Network/transport failure: keep serving the stale Set. Detail to console
    // only, never echoed. Reset the timestamp would hot-loop; leave it so the
    // next request re-attempts after the TTL elapses naturally.
    console.error(
      "[middleware/denylist]",
      err instanceof Error ? err.message : "refresh failed",
    );
  } finally {
    denylistRefreshInFlight = false;
  }
}

/**
 * Snapshot + clear the rollup/offender/event buffers and POST them to the node
 * ingest route. Called at most once per FLUSH_INTERVAL_MS. Fire-and-forget via
 * event.waitUntil. Under a sustained flood this caps DB writes at ~6/min per
 * edge instance regardless of incoming request volume.
 */
async function flushTelemetry(origin: string, secret: string): Promise<void> {
  // Snapshot then clear synchronously so concurrent requests start a fresh
  // window while this batch is in flight. Each rollup key encodes its own
  // minute (`${minuteISO}|${keyPrefix}|${decision}`); the ingest route stamps
  // bucket_minute from the body's bucketMinute, so we group rows by minute and
  // send one POST per distinct minute. A flush that straddles a minute boundary
  // therefore preserves per-minute accuracy (almost always exactly one minute).
  const byMinute = new Map<string, TelemetryRollupRow[]>();
  rollupBuckets.forEach((count, key) => {
    const firstSep = key.indexOf("|");
    const sep = key.lastIndexOf("|");
    if (firstSep < 0 || sep <= firstSep) return;
    const minute = key.slice(0, firstSep);
    const keyPrefix = key.slice(firstSep + 1, sep);
    const decisionRaw = key.slice(sep + 1);
    if (
      decisionRaw !== "allow" &&
      decisionRaw !== "block" &&
      decisionRaw !== "denylist"
    ) {
      return;
    }
    const arr = byMinute.get(minute) ?? [];
    arr.push({ key_prefix: keyPrefix, decision: decisionRaw, count });
    byMinute.set(minute, arr);
  });

  // Derive flood/bruteforce offender events from the bounded ipCounts map.
  const offenders = Array.from(ipCounts.entries())
    .filter((entry) => entry[1] >= OFFENDER_FLOOD_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, OFFENDER_TOP_N);

  const offenderEvents: SecurityEventInput[] = offenders.map((entry) => ({
    ip: entry[0],
    category: "flood",
    severity: entry[1] >= OFFENDER_FLOOD_THRESHOLD * 4 ? 5 : 3,
    detail: { requests_in_window: entry[1], window_ms: FLUSH_INTERVAL_MS },
  }));

  const events = pendingEvents.concat(offenderEvents);

  // Clear buffers now (fresh window for concurrent/next requests).
  rollupBuckets.clear();
  ipCounts.clear();
  pendingEvents.length = 0;

  if (byMinute.size === 0 && events.length === 0) return;

  try {
    // One POST per distinct minute in the snapshot (almost always exactly one).
    const minutes =
      byMinute.size > 0 ? Array.from(byMinute.keys()) : [minuteIso(Date.now())];
    for (let i = 0; i < minutes.length; i++) {
      const minute = minutes[i];
      const rows = byMinute.get(minute) ?? [];
      // Attach the discrete events to the first request only so they aren't
      // duplicated across multi-minute flushes.
      const body = JSON.stringify({
        bucketMinute: minute,
        rollups: rows,
        events: i === 0 ? events : [],
      });
      await fetch(`${origin}/api/internal/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": secret },
        body,
        signal: AbortSignal.timeout(5000),
      });
    }
  } catch (err) {
    // Telemetry is best-effort. A failed flush drops one window of counts; it
    // must never affect request handling. Detail to console only.
    console.error(
      "[middleware/telemetry]",
      err instanceof Error ? err.message : "flush failed",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-route rate limits
// ─────────────────────────────────────────────────────────────────────────────

interface RouteLimit {
  test: (path: string) => boolean;
  max: number;
  windowMs: number;
  keyPrefix: string;
  /** Optional HTTP method filter (e.g. "POST"). If omitted, matches any method. */
  method?: string;
}

const ROUTE_LIMITS: RouteLimit[] = [
  // Auth — strict (anti brute-force)
  {
    test: (p) => p === "/api/auth/login" || p === "/api/auth/check-lock",
    max: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "auth-login",
  },
  {
    test: (p) => p === "/api/auth/record-attempt",
    max: 20,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "auth-record",
  },
  {
    test: (p) => p === "/api/auth/clear-attempts",
    max: 20,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "auth-clear",
  },

  // AI endpoints — expensive, anti-abuse
  // Ninny generate: 5/15min per IP. Combined with the per-user 20/day cap
  // and Fangs cost, this protects OpenAI bill from any one IP slamming.
  {
    test: (p) => p === "/api/ninny/generate",
    max: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "ninny-gen",
  },
  // Ninny chat: more permissive (real conversations) but still bounded.
  // 30/min per IP allows fast back-and-forth without enabling abuse.
  {
    test: (p) => p === "/api/ninny/chat",
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: "ninny-chat",
  },
  {
    test: (p) => p === "/api/games/pdf",
    max: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "games-pdf",
  },
  // Pardy submit — even with the unique-tile-claim ledger preventing
  // replay-farming, a determined attacker could brute-force answers
  // across all 25 tiles in seconds. Cap submission rate at 60/min/IP.
  {
    test: (p) => p === "/api/games/pardy/submit",
    max: 60,
    windowMs: 60 * 1000,
    keyPrefix: "pardy-submit",
  },

  // Mastery Mode — parse is a Claude Sonnet call, strict cap; the rest are
  // chatty but bounded. Per-user daily cost is bounded by the server-side
  // teaching-panel + socratic caps inside each session.
  {
    test: (p) => p === "/api/mastery/parse",
    max: 10,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "mastery-parse",
  },
  {
    test: (p) =>
      /^\/api\/mastery\/sessions\/[^/]+\/(next|answer|socratic)$/.test(p),
    max: 60,
    windowMs: 60 * 1000,
    keyPrefix: "mastery-loop",
  },
  {
    test: (p) => /^\/api\/mastery\/sessions\/[^/]+\/prefetch$/.test(p),
    max: 20,
    windowMs: 60 * 1000,
    keyPrefix: "mastery-prefetch",
  },
  {
    test: (p) => /^\/api\/mastery\/sessions\/[^/]+\/heartbeat$/.test(p),
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: "mastery-heartbeat",
  },
  // Quick Note shortcut — small AI call per save when no class is set.
  // Bound at 30/min per IP so an autoclicker can't burn through credits.
  {
    test: (p) => p === "/api/classes/quick-note",
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: "classes-quicknote",
  },
  // Daily plan generation — one AI call per class per day, but cap so
  // hitting `?regenerate=1` repeatedly can't burn credits.
  {
    test: (p) => /^\/api\/classes\/[^/]+\/plan$/.test(p),
    max: 10,
    windowMs: 60 * 1000,
    keyPrefix: "classes-plan",
  },
  // Syllabus upload — Storage download + GPT-4o-mini parse per call. Capped
  // tightly so a malicious client can't burn AI credits in a loop.
  {
    test: (p) => /^\/api\/classes\/[^/]+\/syllabus$/.test(p),
    max: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "classes-syllabus",
  },
  // Class notes POST — kicks fire-and-forget GPT card generation per save
  // (≥80 chars). Cap so an autoclicker can't fire 100+ background AI calls.
  {
    test: (p) => /^\/api\/classes\/[^/]+\/notes$/.test(p),
    max: 15,
    windowMs: 60 * 1000,
    keyPrefix: "classes-notes",
  },

  // Academia ICS import (PREVIEW mode) — this POST triggers an OUTBOUND fetch
  // to a user-supplied URL (an SSRF-class surface, guarded server-side with a
  // pinned-lookup + per-hop re-validation). Cap tighter than the generic
  // 100/min so the outbound-fetch surface can't be hammered: 10/min/IP is
  // plenty for a human pasting a calendar link and committing the result.
  {
    test: (p) => p === "/api/academia/import-ics",
    method: "POST",
    max: 10,
    windowMs: 60 * 1000,
    keyPrefix: "academia-import-ics",
  },

  // Resume Coach — Pro-tier exclusive. /analyze does PDF parse + gpt-4o-mini
  // (~$0.01/call); /answer is a smaller AI call per Socratic turn. Per-IP
  // caps stack on top of the server-side Pro gate so a hijacked Pro token
  // can't burn unbounded credit either.
  {
    test: (p) => p === "/api/coach/resume/analyze",
    method: "POST",
    max: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "coach-analyze",
  },
  {
    test: (p) => p === "/api/coach/resume/answer",
    method: "POST",
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: "coach-answer",
  },

  // Email-sending routes — anti-spam
  {
    test: (p) => p === "/api/contact" || p === "/api/waitlist",
    max: 3,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "email",
  },
  // Mastery exam session-create sends a Resend email on POST, so it belongs in
  // the email bucket (GET listings stay on the catch-all). Dynamic [id] segment
  // matched the same way as the rest of the mastery routes above.
  {
    test: (p) => /^\/api\/mastery\/exams\/[^/]+\/sessions$/.test(p),
    method: "POST",
    max: 3,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "email",
  },

  // Vocab — MyMemory translate proxy. 30/min/IP is plenty for a real learner
  // typing one word at a time; blocks scrapers that would burn the
  // MyMemory free-tier quota (50k chars/day with the de=<email> bump).
  {
    test: (p) => p === "/api/vocab/translate",
    method: "POST",
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: "vocab-translate",
  },
  // Vocab writes — save a word OR submit a review. 20/min/IP bounds auto-
  // clicker abuse of the +5 / +2 Fangs grants. Both routes share the bucket
  // because they're both currency-mutating vocab writes.
  {
    test: (p) =>
      p === "/api/vocab/words" || /^\/api\/vocab\/review\/[^/]+$/.test(p),
    method: "POST",
    max: 20,
    windowMs: 60 * 1000,
    keyPrefix: "vocab-write",
  },
  // Vocab discover — Word Banks V3A public browse. Pure read, light query
  // (banks + author profiles + word counts). 60/min/IP comfortably covers
  // a user paging through Discover; blocks scrapers that would walk every
  // public bank.
  {
    test: (p) => p === "/api/vocab/banks/discover",
    method: "GET",
    max: 60,
    windowMs: 60 * 1000,
    keyPrefix: "vocab-discover",
  },
  // Vocab clone — V3A deep-copy via clone_bank RPC. Creates a bank +
  // potentially hundreds of word rows + a coin_transactions row. Cap
  // tightly (5/min/IP) so a malicious client can't fill their library
  // with cloned content or burn the +25 Fang reward in a loop.
  {
    test: (p) => /^\/api\/vocab\/banks\/[^/]+\/clone$/.test(p),
    method: "POST",
    max: 5,
    windowMs: 60 * 1000,
    keyPrefix: "vocab-clone",
  },
  // Vocab define — Wikipedia (free) then OpenAI gpt-4o-mini fallback per term.
  // 20/min/IP caps the AI fallback cost in the worst case. The per-term global
  // cache means a popular term is exactly one OpenAI call across all users
  // ever, so the real ceiling is "new unique terms per IP per minute" — 20
  // already pessimistic. Combined with max_tokens: 80 (~$0.0005/call), even
  // a sustained 20/min for an hour is ~$0.60.
  {
    test: (p) => p === "/api/vocab/define",
    method: "POST",
    max: 20,
    windowMs: 60 * 1000,
    keyPrefix: "vocab-define",
  },

  // Party — Sketchy stroke flush is ~120/min/drawer legit traffic (500ms
  // batches), so the catch-all 100/min drops real strokes mid-round. Cap at
  // 240/min/IP for 2x headroom. Other party routes stay on the catch-all
  // until the broader party audit lands.
  {
    test: (p) => /^\/api\/party\/sketch\/rounds\/[^/]+\/strokes$/.test(p),
    method: "POST",
    max: 240,
    windowMs: 60 * 1000,
    keyPrefix: "party-strokes",
  },

  // Session lifecycle — presence heartbeat fires every ~10s from every
  // active tab. 30/min/IP gives 3x headroom for a single user + handles
  // households on one NAT without throttling.
  {
    test: (p) => p === "/api/presence/heartbeat",
    method: "POST",
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: "presence-heartbeat",
  },
  // Phase 2 Tier 3 refresh-resumable state. Each game page debounces its
  // autosave POSTs to 500ms — well under these ceilings. GETs are once per
  // page mount; shared bucket. Mastery state covers the per-session
  // textarea + current-question pointer; daily-drill state is lower-volume
  // because it only writes once per answered question.
  {
    test: (p) => /^\/api\/mastery\/sessions\/[^/]+\/state$/.test(p),
    max: 60,
    windowMs: 60 * 1000,
    keyPrefix: "mastery-state",
  },
  {
    test: (p) => p === "/api/quiz/state",
    max: 60,
    windowMs: 60 * 1000,
    keyPrefix: "quiz-state",
  },
  {
    test: (p) => p === "/api/daily-drill/state",
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: "daily-drill-state",
  },
  // Post-round vote tally — both POST (cast/change) and GET (poll). 10/min
  // covers a few "change my mind" toggles + a polling tab without
  // tripping. Matches both URLs since GET fetches /votes and POST fires at
  // /vote — pattern uses a non-capturing group.
  {
    test: (p) => /^\/api\/party\/rounds\/[^/]+\/votes?$/.test(p),
    max: 10,
    windowMs: 60 * 1000,
    keyPrefix: "party-vote",
  },

  // Stripe checkout + portal — anti-abuse (5/min/IP). Webhook is exempted
  // below: Stripe MUST be able to hit it freely + retry on 5xx without
  // tripping any throttle.
  {
    test: (p) => p === "/api/stripe/checkout",
    method: "POST",
    max: 5,
    windowMs: 60 * 1000,
    keyPrefix: "stripe-checkout",
  },
  {
    test: (p) => p === "/api/stripe/portal",
    method: "POST",
    max: 5,
    windowMs: 60 * 1000,
    keyPrefix: "stripe-portal",
  },
  {
    test: (p) => p === "/api/stripe/fang-purchase",
    method: "POST",
    max: 10,
    windowMs: 60 * 1000,
    keyPrefix: "stripe-fang-purchase",
  },

  // Currency-mutating financial routes — anti-burst. Every route that mints or
  // spends Fangs lives here at 60/min so the anti-burst envelope is uniform.
  // (Each also has its own server-side idempotency/daily cap — this is the
  // secondary, IP-level defense.) The earn routes below previously fell only to
  // the 100/min catch-all; they belong in this tighter bucket.
  {
    test: (p) =>
      p === "/api/save-quiz-results" ||
      p === "/api/place-bet" ||
      p === "/api/claim-bounty" ||
      p === "/api/games/reward" ||
      p.startsWith("/api/shop/") ||
      p === "/api/ninny/complete" ||
      p === "/api/ninny/abandon" ||
      p === "/api/ninny/unlock" ||
      p === "/api/missions/claim" ||
      p === "/api/focus-session" ||
      p === "/api/daily-drill/complete" ||
      p === "/api/spin/roll" ||
      p === "/api/login-bonus" ||
      /^\/api\/mastery\/sessions\/[^/]+\/complete$/.test(p),
    max: 60,
    windowMs: 60 * 1000,
    keyPrefix: "fin",
  },

  // Arena routes — moderate (real-time gameplay)
  {
    test: (p) => p.startsWith("/api/arena/"),
    max: 120,
    windowMs: 60 * 1000,
    keyPrefix: "arena",
  },

  // Admin team management — privileged IAM mutations (provision, offboard,
  // reactivate, suspend, reset-password). Each creates or alters a staff
  // identity, so cap tighter than the generic admin-write bucket: 15/min/IP is
  // ample for a human running team ops and blocks a hijacked admin token from
  // mass-provisioning accounts. Must precede the broad /api/admin/ rules below
  // (first match wins) so it actually takes effect.
  {
    test: (p) => p.startsWith("/api/admin/team/"),
    method: "POST",
    max: 15,
    windowMs: 60 * 1000,
    keyPrefix: "admin-team-write",
  },
  // Admin credential vault — per-credential ops at /api/admin/vault/<id>:
  // reveal (POST, returns a decrypted secret), update (PATCH), and delete
  // (DELETE). No method filter so all three mutating verbs get the same tight
  // 30/min/IP cap (a POST-only filter would let PATCH/DELETE fall through to
  // the looser admin-read bucket). The list GET / create POST live at
  // /api/admin/vault (no trailing slash) and intentionally do not match here.
  // Placed above the broad /api/admin/ rules (first match wins).
  {
    test: (p) => p.startsWith("/api/admin/vault/"),
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: "admin-vault",
  },

  // Admin console — staff-only surface, low legitimate volume. Tighter cap
  // for POSTs (mutations: resets, Fang adjustments, suspensions) than reads.
  {
    test: (p) => p.startsWith("/api/admin/"),
    method: "POST",
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: "admin-write",
  },
  {
    test: (p) => p.startsWith("/api/admin/"),
    max: 120,
    windowMs: 60 * 1000,
    keyPrefix: "admin-read",
  },

  // Account data-export — GDPR data-portability bundle. Server-side the route is
  // gated to ONE export per 24h via an atomic claim, but the bundle is 8 tables
  // and the response can be a multi-MB blob, so cap the request rate hard at
  // 3/min/IP. Matches both GET (current method) and POST (future-proof) since the
  // rule omits a method filter.
  {
    test: (p) => p === "/api/user/export",
    max: 3,
    windowMs: 60 * 1000,
    keyPrefix: "user-export",
  },
  // Account lifecycle — destructive/irreversible mutations. Hard-delete
  // (DELETE /api/user/account) and deactivate (POST /api/user/account/deactivate)
  // share one tight bucket at 5/min/IP. The cancel-deletion subroute stays on the
  // catch-all (this rule matches only the two exact paths/methods below).
  {
    test: (p) => p === "/api/user/account",
    method: "DELETE",
    max: 5,
    windowMs: 60 * 1000,
    keyPrefix: "user-account-lifecycle",
  },
  {
    test: (p) => p === "/api/user/account/deactivate",
    method: "POST",
    max: 5,
    windowMs: 60 * 1000,
    keyPrefix: "user-account-lifecycle",
  },

  // Social fan-out routes — anti-spam. Both already enforce server-side caps
  // (friends: a UNIQUE constraint + existing-friendship check; request-join: a
  // 3-pending-total cap + 5-min per-room cooldown), so this is the IP-level
  // anti-burst layer on top: a hijacked account can't blast hundreds of distinct
  // targets/rooms per minute. POST-only so the GET status polls stay unthrottled.
  {
    test: (p) => p === "/api/social/friends",
    method: "POST",
    max: 20,
    windowMs: 60 * 1000,
    keyPrefix: "social-friend-req",
  },
  {
    test: (p) => /^\/api\/party\/rooms\/[^/]+\/request-join$/.test(p),
    method: "POST",
    max: 20,
    windowMs: 60 * 1000,
    keyPrefix: "party-request-join",
  },

  // Blitz questions — static JSON pool, but returns up to 50 full MCQs WITH
  // correct_answer + explanation per call. On the catch-all (100/min) one account
  // could pull ~5k answered Qs/min; 20/min/IP covers a human starting many rounds
  // and blocks casual scraping of the finite Blitz pool.
  {
    test: (p) => p === "/api/games/blitz/questions",
    method: "GET",
    max: 20,
    windowMs: 60 * 1000,
    keyPrefix: "blitz-questions",
  },

  // Catch-all for other API routes
  {
    test: (p) => p.startsWith("/api/"),
    max: 100,
    windowMs: 60 * 1000,
    keyPrefix: "api",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Security headers
// ─────────────────────────────────────────────────────────────────────────────

const CDN_HOST = process.env.NEXT_PUBLIC_CDN_URL?.replace(/^https?:\/\//, "") ?? "";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  // CSP — covers Next.js, Google Fonts, DiceBear, Supabase, CloudFront CDN, Stripe
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://api.dicebear.com https://*.supabase.co${CDN_HOST ? ` https://${CDN_HOST}` : ""}`,
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://api.groq.com https://api.stripe.com",
    "frame-src https://js.stripe.com https://www.youtube.com https://www.youtube-nocookie.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

// ─────────────────────────────────────────────────────────────────────────────
// Middleware entry
// ─────────────────────────────────────────────────────────────────────────────

export function middleware(request: NextRequest, event: NextFetchEvent) {
  maybePurge();

  const { pathname } = request.nextUrl;

  // Stripe webhook MUST pass through untouched. Stripe signs the EXACT raw
  // bytes of the request body; any middleware that reads/clones req.body
  // silently breaks signature verification. We also skip rate-limiting so
  // Stripe's bursty retry behavior isn't throttled. Trailing-slash variant
  // covered for defense-in-depth even though Stripe always sends without.
  // (Telemetry is also skipped here so the webhook path stays pristine.)
  if (pathname === "/api/stripe/webhook" || pathname === "/api/stripe/webhook/") {
    return NextResponse.next();
  }

  // Internal telemetry/denylist routes are called BY this middleware itself
  // (same-origin, via event.waitUntil). Exempt them like the webhook so the
  // pipeline's own flush/refresh traffic can never trip the catch-all rate
  // limit (which would silently drop telemetry during a flood, exactly when we
  // need it) and never self-feeds the rollup. They are gated by x-internal-secret.
  if (pathname.startsWith("/api/internal/")) {
    return NextResponse.next();
  }

  // Prefer the platform-trusted client IP (request.ip, set by Vercel's edge
  // from the verified connection) over the spoofable forwarded headers; fall
  // back to the leftmost x-forwarded-for hop, then x-real-ip, then 'unknown'.
  const ip =
    request.ip ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  // Telemetry + denylist are entirely dormant unless the secret is configured.
  const secret = internalSecret();
  const telemetryEnabled = secret !== "";
  const origin = request.nextUrl.origin;
  const now = Date.now();
  const minute = minuteIso(now);
  const ua = request.headers.get("user-agent");

  // ── IP denylist enforcement (before the rate-limit loop) ──────────────────
  if (telemetryEnabled) {
    // Schedule a TTL refresh as fire-and-forget; serve the stale Set meanwhile.
    if (now - lastDenylistFetchAt > DENYLIST_TTL_MS && !denylistRefreshInFlight) {
      event.waitUntil(refreshDenylist(origin, secret));
    }

    if (ip !== "unknown" && denylistSet.has(ip)) {
      // Record the denylist decision in the rollup + a discrete hit event, then
      // reject early with a generic body. No rate-limit state is touched.
      bumpRollup(minute, "denylist", "denylist");
      bumpIp(ip);
      pushEvent({
        ip,
        category: "denylist_hit",
        severity: 4,
        path: pathname,
        method: request.method,
        user_agent: ua ?? undefined,
      });
      maybeFlush(event, origin, secret, now);
      return new NextResponse(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ── Rate-limit loop (UNCHANGED semantics: first match wins, then break) ────
  // We track the matched keyPrefix + whether the request was blocked, purely to
  // feed telemetry. The allow/block decision and the 429 response are byte-for-
  // byte identical to the previous behavior.
  let matchedPrefix: string | null = null;
  let blocked = false;
  let rateLimitResponse: NextResponse | null = null;

  for (const rule of ROUTE_LIMITS) {
    if (rule.method && rule.method !== request.method) continue;
    if (rule.test(pathname)) {
      matchedPrefix = rule.keyPrefix;
      const allowed = checkRateLimit(`${rule.keyPrefix}:${ip}`, rule.max, rule.windowMs);
      if (!allowed) {
        blocked = true;
        rateLimitResponse = new NextResponse(
          JSON.stringify({ error: "Too many requests. Try again shortly." }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(Math.ceil(rule.windowMs / 1000)),
            },
          },
        );
      }
      break;
    }
  }

  // ── Telemetry aggregation (fire-and-forget; never affects the response) ────
  if (telemetryEnabled) {
    const keyPrefix = matchedPrefix ?? pathGroup(pathname);
    const decision: Decision = blocked ? "block" : "allow";
    bumpRollup(minute, keyPrefix, decision);
    // Count the request once, then a second time when it tripped a 429 so the
    // top-offender ranking weights throttle-tripping IPs above merely chatty
    // ones when escalating to flood/bruteforce events at flush time.
    bumpIp(ip);
    if (blocked) bumpIp(ip);

    // Vuln-scanner / config-exfil probe hit on the path.
    const badPath = matchBadPath(pathname);
    if (badPath.hit) {
      pushEvent({
        ip,
        category: badPath.category,
        severity: badPath.category === "scanner" ? 4 : 2,
        path: pathname,
        method: request.method,
        user_agent: ua ?? undefined,
      });
    } else if (pathname.startsWith("/api/") && isSuspiciousUserAgent(ua)) {
      // Non-browser client hitting an API surface. Scanner tooling outranks a
      // bare HTTP-library UA, so split the severity.
      pushEvent({
        ip,
        category: "bot",
        severity: isScannerUserAgent(ua) ? 4 : 1,
        path: pathname,
        method: request.method,
        user_agent: ua ?? undefined,
      });
    }

    maybeFlush(event, origin, secret, now);
  }

  if (rateLimitResponse) return rateLimitResponse;

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Schedule a telemetry flush when the flush interval has elapsed. Synchronous
 * gate (lastFlushAt is advanced before the async work starts) so concurrent
 * requests do not each schedule a duplicate flush. The actual POST runs inside
 * event.waitUntil so it never blocks the response.
 */
function maybeFlush(
  event: NextFetchEvent,
  origin: string,
  secret: string,
  now: number,
): void {
  if (now - lastFlushAt <= FLUSH_INTERVAL_MS) return;
  lastFlushAt = now;
  event.waitUntil(flushTelemetry(origin, secret));
}

export const config = {
  // Apply to all routes except Next.js internals and static files. The primary
  // entry is kept intact; the additional entries below opt specific vuln-probe
  // paths (which the `.*\..*` rule would otherwise exclude as "static") BACK in
  // so they can be observed + denylist-blocked. We deliberately do NOT enable
  // middleware on real static assets.
  matcher: [
    "/((?!_next/|favicon\\.ico|.*\\..*).*)",
    // Dot-file / config-exfil probes that contain a dot and would be skipped.
    "/.env/:path*",
    "/.env",
    "/.git/:path*",
    "/.git",
    "/.aws/:path*",
    "/.ssh/:path*",
    "/.svn/:path*",
    "/config.json",
    "/wp-config.php",
    "/wp-login.php",
    "/xmlrpc.php",
    "/adminer.php",
  ],
};
