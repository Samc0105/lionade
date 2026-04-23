import type { MetadataRoute } from "next";

/**
 * Next.js auto-generates `/robots.txt` from this route. We invite crawlers
 * to index the public marketing pages and keep them off the authenticated
 * app surface (which would 404/redirect them anyway) and the API.
 */

const BASE = "https://getlionade.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/onboarding",
          "/dashboard",
          "/learn",
          "/learn/",
          "/arena",
          "/compete",
          "/duel",
          "/games",
          "/profile",
          "/settings",
          "/shop",
          "/social",
          "/wallet",
          "/leaderboard",
          "/badges",
          "/quiz",
          "/login",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
