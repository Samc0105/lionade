/**
 * Single source of truth for Lionade's public URL + brand strings. Every
 * reference to "https://getlionade.com" across the codebase reads from here
 * so a domain change lands in ONE file (plus the env var).
 *
 * Configure via `NEXT_PUBLIC_SITE_URL` on Vercel (falls back to the current
 * production domain for local dev).
 *
 * Import rule:
 *   - Server code (metadata, sitemap, robots, layouts): import { SITE_URL }
 *   - Client code that needs it at runtime: same import — NEXT_PUBLIC_ is
 *     inlined at build time so both sides see the same value.
 */

const DEFAULT_URL = "https://getlionade.com";

/** Normalized absolute URL with no trailing slash. */
export const SITE_URL: string = (() => {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_URL;
  return raw.replace(/\/+$/, "");
})();

/** `URL` object version for places that need it (metadataBase, etc.). */
export const SITE_URL_OBJ: URL = new URL(SITE_URL);

/** Hostname only, e.g. "getlionade.com". Used for copy like "© getlionade.com". */
export const SITE_HOST: string = SITE_URL_OBJ.host;

/** Default sender/support email — derived from the host. */
export const SUPPORT_EMAIL = `support@${SITE_HOST}`;

/**
 * Security-report inbox for the vulnerability disclosure policy. Preferred
 * contact in /.well-known/security.txt; falls back to SUPPORT_EMAIL for
 * reporters if the dedicated alias is not yet provisioned.
 */
export const SECURITY_EMAIL = `security@${SITE_HOST}`;

/**
 * Onboarding-funnel enforcement cutoff. Accounts created BEFORE this are
 * grandfathered and skip the funnel (they predate it being enforced, so the
 * fix must not trap them); accounts created on or after must complete
 * onboarding (`profiles.onboarding_completed = true`). Used by ProtectedRoute
 * and the onboarding page so the two gates cannot drift. profiles.created_at is
 * NOT NULL DEFAULT NOW(), so this comparison is reliable.
 */
export const ONBOARDING_ENFORCED_FROM = "2026-06-29T00:00:00Z";

/** Join a relative path to the site URL. `absoluteUrl("/about") → "https://…/about"`. */
export function absoluteUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${clean}`;
}
