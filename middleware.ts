import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting + security headers middleware
//
// In-memory rate limiter — works fine for single-instance dev/single-region.
// For Vercel multi-region production, swap for Upstash Redis:
//   npm install @upstash/ratelimit @upstash/redis
//   Then read UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN from env.
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitRecord>();

function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const record = store.get(key);
  if (!record || now > record.resetAt) {
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

export function middleware(request: NextRequest) {
  maybePurge();

  const { pathname } = request.nextUrl;

  // Stripe webhook MUST pass through untouched. Stripe signs the EXACT raw
  // bytes of the request body; any middleware that reads/clones req.body
  // silently breaks signature verification. We also skip rate-limiting so
  // Stripe's bursty retry behavior isn't throttled. Trailing-slash variant
  // covered for defense-in-depth even though Stripe always sends without.
  if (pathname === "/api/stripe/webhook" || pathname === "/api/stripe/webhook/") {
    return NextResponse.next();
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  // Apply rate limit if any rule matches (first match wins)
  for (const rule of ROUTE_LIMITS) {
    if (rule.method && rule.method !== request.method) continue;
    if (rule.test(pathname)) {
      const allowed = checkRateLimit(`${rule.keyPrefix}:${ip}`, rule.max, rule.windowMs);
      if (!allowed) {
        return new NextResponse(
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

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  // Apply to all routes except Next.js internals and static files
  matcher: ["/((?!_next/|favicon\\.ico|.*\\..*).*)"],
};
