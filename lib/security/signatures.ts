/**
 * Edge-safe security signatures.
 *
 * THE EDGE INVARIANT: this module is bundled into `middleware.ts`, which runs
 * on the Vercel/Next.js Edge runtime. It must therefore be a PURE module:
 *   - NO node built-ins ('crypto', 'fs', 'net', 'os', Buffer, ...)
 *   - NO supabaseAdmin / service-role import
 *   - NO outbound IO of any kind
 * Everything here is plain string/regex logic over the incoming request so the
 * edge can make an allow/block decision before any node route is touched.
 *
 * The signature lists below are deliberately conservative. We would rather miss
 * a clever probe than block a real student. Anything that looks like routine
 * browser/app traffic must pass.
 */

// ---------------------------------------------------------------------------
// Shared telemetry / event types (the node ingest route writes these to the DB)
// ---------------------------------------------------------------------------

/** One low-cardinality rollup bucket: a key prefix x a decision x a count. */
export type TelemetryRollupRow = {
  /** Rate-limit key prefix, or a coarse pathGroup() value, or 'unmatched'. */
  key_prefix: string;
  decision: "allow" | "block" | "denylist";
  count: number;
};

/** A single security event the middleware (or a route) wants recorded. */
export type SecurityEventInput = {
  ip: string;
  category:
    | "scanner"
    | "bruteforce"
    | "enumeration"
    | "bot"
    | "flood"
    | "denylist_hit"
    | "auth_failure"
    | "admin_probe";
  /** 1 = noise, higher = more serious. Defaults to 1 at the DB level. */
  severity?: number;
  path?: string;
  method?: string;
  user_agent?: string;
  detail?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Known-bad path signatures (vuln-scanner / config-exfil probes)
// ---------------------------------------------------------------------------

/**
 * Common probe paths seen from automated vuln scanners and config-exfil bots.
 * These mirror the OWASP "Forced browsing" / sensitive-file-disclosure probes
 * and the top hits in any public web-server access log. We split them into:
 *
 *   - 'scanner'     : config/secret/tooling exfil and CMS exploit probes
 *   - 'enumeration' : directory/admin-panel discovery probes
 *
 * Matching is done on the lowercased pathname only (never the query string),
 * via three modes:
 *   - prefix : pathname starts with the token (covers a whole tree)
 *   - exact  : pathname equals the token exactly
 *   - contains: token appears anywhere in the pathname (path-traversal style)
 *
 * IMPORTANT BENIGN EXCLUSIONS:
 *   - /.well-known/* is legitimate (security.txt, ACME, apple-app-site-assoc,
 *     assetlinks, change-password). It is explicitly NOT a bad path.
 */
type MatchMode = "prefix" | "exact" | "contains";
type BadPathRule = {
  token: string;
  mode: MatchMode;
  category: "scanner" | "enumeration";
};

export const KNOWN_BAD_PATHS: readonly BadPathRule[] = [
  // --- Secret / config file exfil (scanner) ---
  { token: "/.env", mode: "prefix", category: "scanner" }, // .env, .env.local, .env.production
  { token: "/.git", mode: "prefix", category: "scanner" }, // /.git, /.git/config, /.git/HEAD
  { token: "/.svn", mode: "prefix", category: "scanner" },
  { token: "/.hg", mode: "prefix", category: "scanner" },
  { token: "/.aws", mode: "prefix", category: "scanner" }, // /.aws/credentials
  { token: "/.ssh", mode: "prefix", category: "scanner" }, // /.ssh/id_rsa
  { token: "/.npmrc", mode: "exact", category: "scanner" },
  { token: "/.netrc", mode: "exact", category: "scanner" },
  { token: "/.htaccess", mode: "exact", category: "scanner" },
  { token: "/.htpasswd", mode: "exact", category: "scanner" },
  { token: "/.dockerenv", mode: "exact", category: "scanner" },
  { token: "/.docker", mode: "prefix", category: "scanner" },
  { token: "/.ds_store", mode: "contains", category: "scanner" }, // /.DS_Store anywhere
  { token: "/config.json", mode: "exact", category: "scanner" },
  { token: "/config.php", mode: "exact", category: "scanner" },
  { token: "/configuration.php", mode: "exact", category: "scanner" },
  { token: "/settings.py", mode: "exact", category: "scanner" },
  { token: "/credentials", mode: "exact", category: "scanner" },
  { token: "/secrets.json", mode: "exact", category: "scanner" },
  { token: "/wp-config.php", mode: "exact", category: "scanner" },
  { token: "/web.config", mode: "exact", category: "scanner" },
  { token: "/composer.lock", mode: "exact", category: "scanner" },
  { token: "/composer.json", mode: "exact", category: "scanner" },
  { token: "/package-lock.json", mode: "exact", category: "scanner" },
  { token: "/yarn.lock", mode: "exact", category: "scanner" },
  { token: "/dump.sql", mode: "exact", category: "scanner" },
  { token: "/backup.sql", mode: "exact", category: "scanner" },
  { token: "/database.sql", mode: "exact", category: "scanner" },
  { token: "/id_rsa", mode: "exact", category: "scanner" },
  { token: "/server-status", mode: "prefix", category: "scanner" }, // Apache mod_status

  // --- WordPress / PHP CMS exploit probes (scanner) ---
  { token: "/wp-login.php", mode: "exact", category: "scanner" },
  { token: "/wp-admin", mode: "prefix", category: "scanner" },
  { token: "/wp-content", mode: "prefix", category: "scanner" },
  { token: "/wp-includes", mode: "prefix", category: "scanner" },
  { token: "/wp-json", mode: "prefix", category: "scanner" },
  { token: "/xmlrpc.php", mode: "exact", category: "scanner" },
  { token: "/wlwmanifest.xml", mode: "contains", category: "scanner" },

  // --- Vendored / framework leak probes (scanner) ---
  { token: "/vendor/", mode: "prefix", category: "scanner" }, // /vendor/phpunit/... RCE chain
  { token: "/vendor/phpunit", mode: "prefix", category: "scanner" },

  // --- Management-console / actuator probes (scanner) ---
  { token: "/actuator", mode: "prefix", category: "scanner" }, // Spring Boot actuator
  { token: "/.aws/credentials", mode: "exact", category: "scanner" },
  { token: "/telescope", mode: "prefix", category: "scanner" }, // Laravel Telescope
  { token: "/_profiler", mode: "prefix", category: "scanner" }, // Symfony profiler
  { token: "/debug/default/view", mode: "prefix", category: "scanner" }, // Yii debug
  { token: "/console", mode: "exact", category: "scanner" },
  { token: "/cgi-bin/", mode: "prefix", category: "scanner" },

  // --- Admin-panel / DB-tool discovery (enumeration) ---
  { token: "/phpmyadmin", mode: "prefix", category: "enumeration" },
  { token: "/pma", mode: "exact", category: "enumeration" },
  { token: "/myadmin", mode: "prefix", category: "enumeration" },
  { token: "/adminer.php", mode: "exact", category: "enumeration" },
  { token: "/dbadmin", mode: "prefix", category: "enumeration" },
  { token: "/sqlmanager", mode: "prefix", category: "enumeration" },
  { token: "/mysql", mode: "prefix", category: "enumeration" },
  { token: "/administrator", mode: "prefix", category: "enumeration" }, // Joomla
  { token: "/solr", mode: "prefix", category: "enumeration" },
  { token: "/manager/html", mode: "prefix", category: "enumeration" }, // Tomcat manager
  { token: "/jenkins", mode: "prefix", category: "enumeration" },
  { token: "/.well-known/openid-configuration", mode: "exact", category: "enumeration" },
] as const;

/**
 * Paths that look superficially like a probe token but are legitimate and must
 * never be flagged. Checked before KNOWN_BAD_PATHS. Keep this list tight.
 */
const BENIGN_PATH_PREFIXES: readonly string[] = [
  "/.well-known/", // security.txt, ACME http-01, apple-app-site-association, assetlinks.json, change-password
] as const;

/**
 * Classify a pathname against the scanner/enumeration signatures.
 * Returns { hit: false } for benign traffic. Query string is ignored by the
 * caller; pass only the pathname.
 */
export function matchBadPath(
  pathname: string,
): { hit: boolean; category: "scanner" | "enumeration" } {
  // Normalize once. Lowercase so /.GIT and /.git match the same rule, and
  // collapse the empty/root case.
  const p = (pathname || "/").toLowerCase();

  // Benign allowlist wins over everything. /.well-known/security.txt would
  // otherwise look adjacent to a probe, so guard it explicitly.
  for (const safe of BENIGN_PATH_PREFIXES) {
    if (p === safe.slice(0, -1) || p.startsWith(safe)) {
      // The openid-configuration enumeration probe lives under /.well-known/
      // but is a real discovery attempt; let the bad-path list catch it below
      // only if it is the exact known token, not generic .well-known traffic.
      if (p === "/.well-known/openid-configuration") {
        return { hit: true, category: "enumeration" };
      }
      return { hit: false, category: "scanner" };
    }
  }

  for (const rule of KNOWN_BAD_PATHS) {
    if (matchesRule(p, rule)) {
      return { hit: true, category: rule.category };
    }
  }

  return { hit: false, category: "scanner" };
}

function matchesRule(pathname: string, rule: BadPathRule): boolean {
  switch (rule.mode) {
    case "exact":
      return pathname === rule.token;
    case "prefix":
      // Match the token as a whole path segment boundary: '/wp-admin' should
      // match '/wp-admin' and '/wp-admin/...' but NOT '/wp-administrative-x'.
      return (
        pathname === rule.token ||
        pathname.startsWith(rule.token + "/") ||
        // Tokens that already end in '/' are tree prefixes (e.g. '/vendor/').
        (rule.token.endsWith("/") && pathname.startsWith(rule.token)) ||
        // Tokens that look like a file (contain a dot in the last segment)
        // should still prefix-match dot-suffixed siblings like '/.env.local'.
        (hasDotSuffixToken(rule.token) && pathname.startsWith(rule.token))
      );
    case "contains":
      return pathname.includes(rule.token);
    default:
      return false;
  }
}

/**
 * True for tokens like '/.env' or '/.git' where attackers append suffixes
 * ('/.env.local', '/.git/config'). We allow a raw startsWith for these.
 */
function hasDotSuffixToken(token: string): boolean {
  const last = token.slice(token.lastIndexOf("/") + 1);
  return last.startsWith(".");
}

// ---------------------------------------------------------------------------
// User-agent signatures
// ---------------------------------------------------------------------------

/**
 * Substrings that identify offensive-security tooling and scraping clients.
 * Case-insensitive substring match on the raw UA.
 *
 * We split intent:
 *   - SCANNER_UA_TOKENS: pentest / exploit tooling. High confidence malicious.
 *   - GENERIC_CLIENT_UA_TOKENS: raw HTTP libraries with no browser identity.
 *     These are "suspicious" because a real browser session never sends them
 *     to our app surfaces, but they are not proof of attack on their own. We
 *     still treat them as suspicious so the rate limiter can weigh them.
 *
 * We deliberately do NOT include Googlebot/Bingbot/Slackbot/Twitterbot/etc.
 * here. Legit crawlers are classified by isLegitCrawler() and must pass.
 */
const SCANNER_UA_TOKENS: readonly string[] = [
  "sqlmap",
  "nikto",
  "nmap",
  "masscan",
  "zgrab",
  "zmap",
  "nuclei",
  "wpscan",
  "dirbuster",
  "gobuster",
  "feroxbuster",
  "ffuf",
  "hydra",
  "acunetix",
  "nessus",
  "openvas",
  "metasploit",
  "burpsuite",
  "burp",
  "w3af",
  "arachni",
  "skipfish",
  "whatweb",
  "wfuzz",
  "commix",
  "joomscan",
  "censys",
  "shodan",
  "evilbot",
  "xrumer",
  "petalbot-attack",
] as const;

const GENERIC_CLIENT_UA_TOKENS: readonly string[] = [
  "curl/",
  "wget/",
  "python-requests",
  "python-urllib",
  "aiohttp",
  "httpx",
  "go-http-client",
  "okhttp",
  "java/",
  "libwww-perl",
  "perl",
  "ruby",
  "scrapy",
  "node-fetch",
  "axios/",
  "guzzlehttp",
  "winhttp",
  "lwp::simple",
  "fasthttp",
  "http_request",
  "headlesschrome",
  "phantomjs",
] as const;

/**
 * Tokens for legitimate, well-behaved crawlers/agents we never want to flag as
 * malicious. Used only to short-circuit before the suspicious check so a UA
 * that happens to contain a generic token (rare) but is clearly a real crawler
 * is not penalized. These are NOT treated as suspicious.
 */
const LEGIT_CRAWLER_UA_TOKENS: readonly string[] = [
  "googlebot",
  "google-inspectiontool",
  "storebot-google",
  "bingbot",
  "slurp", // Yahoo
  "duckduckbot",
  "baiduspider",
  "yandexbot",
  "applebot",
  "facebookexternalhit",
  "facebookbot",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "pinterest",
  "redditbot",
  "vercel-screenshot",
  "vercelbot",
  "uptimerobot",
  "stripe", // Stripe webhook delivery UA
  "lighthouse",
  "chrome-lighthouse",
  "gptbot", // OpenAI crawler, respects robots; classify as legit crawler
  "ccbot",
  "claudebot",
  "perplexitybot",
] as const;

/** True when the UA matches a known legitimate crawler/agent. */
export function isLegitCrawler(ua: string | null): boolean {
  if (!ua) return false;
  const s = ua.toLowerCase();
  for (const token of LEGIT_CRAWLER_UA_TOKENS) {
    if (s.includes(token)) return true;
  }
  return false;
}

/** True when the UA is offensive-security tooling. High confidence malicious. */
export function isScannerUserAgent(ua: string | null): boolean {
  if (!ua) return false;
  const s = ua.toLowerCase();
  for (const token of SCANNER_UA_TOKENS) {
    if (s.includes(token)) return true;
  }
  return false;
}

/**
 * Conservative "this is not a real browser/app session" check.
 *
 * Returns true for:
 *   - empty / missing UA (every legit browser and our own apps send one)
 *   - known scanner tooling
 *   - raw HTTP-client libraries with no browser identity
 *
 * Returns false for known legitimate crawlers even if their UA brushes a
 * generic token, and for everything that looks like a normal browser/app.
 *
 * This is intentionally a SIGNAL, not a verdict. The middleware combines it
 * with rate-limit state before ever blocking, so a false positive here costs
 * a single counted suspicious request, not a block.
 */
export function isSuspiciousUserAgent(ua: string | null): boolean {
  // Missing or empty UA: real browsers and the Lionade web/iOS clients always
  // send a UA, so absence is itself suspicious.
  if (ua === null || ua.trim() === "") return true;

  // Never penalize verified legit crawlers.
  if (isLegitCrawler(ua)) return false;

  const s = ua.toLowerCase();

  for (const token of SCANNER_UA_TOKENS) {
    if (s.includes(token)) return true;
  }
  for (const token of GENERIC_CLIENT_UA_TOKENS) {
    if (s.includes(token)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Coarse path grouping (bounded-cardinality rollup key)
// ---------------------------------------------------------------------------

/**
 * Collapse an arbitrary pathname into a low-cardinality bucket used as the
 * rollup key_prefix when no rate-limit keyPrefix applies. The whole point is
 * to keep request_telemetry_rollup tiny: minutes x ~45 prefixes x 3 decisions.
 * NEVER return anything containing a user id, slug, or other high-cardinality
 * token, or the rollup table explodes.
 *
 * Output is one of a small, fixed-ish set:
 *   - 'admin'                  : /admin and /admin/*
 *   - 'api:<first-segment>'    : /api/<seg>/...  (seg is a route family)
 *   - 'auth'                   : /login, /signup, /reset, /auth/*
 *   - 'internal'               : /api/internal/*
 *   - 'static'                 : /_next, /static, asset extensions, favicon
 *   - 'well-known'             : /.well-known/*
 *   - 'page'                   : everything else (a normal app page)
 */
export function pathGroup(pathname: string): string {
  const p = (pathname || "/").toLowerCase();

  if (p === "/" ) return "page";

  if (p.startsWith("/.well-known")) return "well-known";

  if (
    p.startsWith("/_next") ||
    p.startsWith("/static") ||
    p === "/favicon.ico" ||
    p === "/robots.txt" ||
    p === "/sitemap.xml" ||
    p === "/manifest.json" ||
    hasStaticExtension(p)
  ) {
    return "static";
  }

  if (p === "/login" || p === "/signup" || p === "/sign-in" || p === "/sign-up") {
    return "auth";
  }
  if (p.startsWith("/auth/") || p.startsWith("/reset") || p.startsWith("/forgot")) {
    return "auth";
  }

  if (p === "/admin" || p.startsWith("/admin/")) return "admin";

  if (p.startsWith("/api/internal")) return "internal";

  if (p.startsWith("/api/")) {
    // Group by the first route-family segment only. e.g.
    //   /api/admin/security/threats -> 'api:admin'
    //   /api/profile/123            -> 'api:profile'
    const rest = p.slice("/api/".length);
    const seg = rest.split("/")[0] || "root";
    // Guard against a high-cardinality first segment (defensive: API families
    // are a closed set, but truncate hard to keep the key bounded).
    const safeSeg = seg.length > 24 ? seg.slice(0, 24) : seg;
    return `api:${safeSeg}`;
  }

  return "page";
}

const STATIC_EXTENSIONS: readonly string[] = [
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".txt",
  ".json",
  ".xml",
  ".pdf",
] as const;

function hasStaticExtension(pathname: string): boolean {
  const lastDot = pathname.lastIndexOf(".");
  if (lastDot < 0) return false;
  const ext = pathname.slice(lastDot);
  // Reject extensions with a '/' after the dot (not a real file extension).
  if (ext.includes("/")) return false;
  return STATIC_EXTENSIONS.includes(ext);
}
