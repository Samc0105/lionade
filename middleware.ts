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

  // AI endpoints — expensive, anti-abuse
  // Ninny: 5/15min per IP. Combined with the per-user 20/day cap and Fangs cost,
  // this protects OpenAI bill from any one IP slamming the endpoint.
  {
    test: (p) => p === "/api/ninny/generate",
    max: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "ninny-gen",
  },
  {
    test: (p) => p === "/api/games/pdf",
    max: 5,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "games-pdf",
  },

  // Email-sending routes — anti-spam
  {
    test: (p) => p === "/api/contact" || p === "/api/waitlist",
    max: 3,
    windowMs: 15 * 60 * 1000,
    keyPrefix: "email",
  },

  // Currency-mutating financial routes — anti-burst
  {
    test: (p) =>
      p === "/api/save-quiz-results" ||
      p === "/api/place-bet" ||
      p === "/api/claim-bounty" ||
      p === "/api/games/reward" ||
      p.startsWith("/api/shop/") ||
      p === "/api/ninny/complete",
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
    "frame-src https://js.stripe.com",
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

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const { pathname } = request.nextUrl;

  // Apply rate limit if any rule matches (first match wins)
  for (const rule of ROUTE_LIMITS) {
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
