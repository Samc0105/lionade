import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory rate limiter
// NOTE: This works for single-instance (dev, single-node). For production on
// Vercel (multi-region, multiple edge workers) swap this for Upstash Redis:
//   npm install @upstash/ratelimit @upstash/redis
//   and configure UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in Vercel.
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitRecord>();

/** Returns true if the request is allowed, false if rate-limited. */
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

/** Purge expired entries every ~500 requests to prevent memory growth. */
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
// Security headers
// ─────────────────────────────────────────────────────────────────────────────

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options":           "DENY",
  "X-Content-Type-Options":    "nosniff",
  "X-XSS-Protection":          "1; mode=block",
  "Referrer-Policy":           "strict-origin-when-cross-origin",
  "Permissions-Policy":        "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  // CSP — allows Next.js inline scripts, Google Fonts, DiceBear avatars, Supabase
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://api.dicebear.com https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

export function middleware(request: NextRequest) {
  maybePurge();

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const { pathname } = request.nextUrl;

  // Per-route rate limits
  let allowed = true;

  if (pathname === "/api/auth/login") {
    // 5 login attempts per IP per 15 minutes
    allowed = checkRateLimit(`login:${ip}`, 5, 15 * 60 * 1000);
  } else if (pathname === "/api/auth/signup") {
    // 3 signups per IP per hour
    allowed = checkRateLimit(`signup:${ip}`, 3, 60 * 60 * 1000);
  } else if (pathname === "/api/auth/record-attempt") {
    // 20 failed attempt recordings per IP per 15 minutes (prevent abuse of this route)
    allowed = checkRateLimit(`record:${ip}`, 20, 15 * 60 * 1000);
  } else if (pathname.startsWith("/api/")) {
    // 100 requests per IP per minute for all other API routes
    allowed = checkRateLimit(`api:${ip}`, 100, 60 * 1000);
  }

  if (!allowed) {
    return new NextResponse(
      JSON.stringify({ error: "Too many attempts. Please try again later." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      }
    );
  }

  const response = NextResponse.next();

  // Apply security headers to all responses
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  // Run on all routes except Next.js internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)"],
};
