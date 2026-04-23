import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/site-config";

/**
 * Next.js auto-generates `/robots.txt` from this route. We invite crawlers
 * to index the public marketing pages and keep them off the authenticated
 * app surface (which would 404/redirect them anyway) and the API.
 */

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
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
