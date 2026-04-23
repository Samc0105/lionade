import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-config";

/**
 * Next.js auto-generates `/sitemap.xml` from this route. Listing only the
 * public marketing pages — the authed app (dashboard, learn, arena, …) is
 * Disallow'd in robots.ts and would be useless to crawl anyway since those
 * routes redirect unauth'd visitors to /login.
 */

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: absoluteUrl("/"),        lastModified: now, changeFrequency: "weekly",  priority: 1.0 },
    { url: absoluteUrl("/about"),   lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/demo"),    lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    { url: absoluteUrl("/contact"), lastModified: now, changeFrequency: "yearly",  priority: 0.5 },
    { url: absoluteUrl("/privacy"), lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: absoluteUrl("/terms"),   lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];
}
