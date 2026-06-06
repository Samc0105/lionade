import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-config";

/**
 * Next.js auto-generates `/sitemap.xml` from this route. We list only the
 * public marketing pages. The authed app (dashboard, learn, arena, etc.)
 * is Disallow'd in robots.ts and would be useless to crawl anyway since
 * those routes redirect unauth'd visitors to /login.
 *
 * Priority guide:
 *   1.0 = homepage (canonical landing)
 *   0.9 = demo (top-of-funnel conversion surface)
 *   0.8 = primary marketing (about, pricing)
 *   0.5 = utility (contact)
 *   0.4 = auth entry (login)
 *   0.3 = legal (privacy, terms)
 */

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: absoluteUrl("/"),        lastModified: now, changeFrequency: "weekly",  priority: 1.0 },
    { url: absoluteUrl("/demo"),    lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    { url: absoluteUrl("/about"),   lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/pricing"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/contact"), lastModified: now, changeFrequency: "yearly",  priority: 0.5 },
    { url: absoluteUrl("/login"),   lastModified: now, changeFrequency: "yearly",  priority: 0.4 },
    { url: absoluteUrl("/privacy"), lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: absoluteUrl("/terms"),   lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];
}
