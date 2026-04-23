import type { MetadataRoute } from "next";

/**
 * Next.js auto-generates `/sitemap.xml` from this route. Listing only the
 * public marketing pages — the authed app (dashboard, learn, arena, …) is
 * Disallow'd in robots.ts and would be useless to crawl anyway since those
 * routes redirect unauth'd visitors to /login.
 *
 * Priority + changeFrequency values are hints, not commands — Google
 * largely ignores them, but we set sensible ones so other crawlers benefit.
 */

const BASE = "https://getlionade.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`,        lastModified: now, changeFrequency: "weekly",  priority: 1.0 },
    { url: `${BASE}/about`,   lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/demo`,    lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/contact`, lastModified: now, changeFrequency: "yearly",  priority: 0.5 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${BASE}/terms`,   lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];
}
