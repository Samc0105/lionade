/**
 * Root Open Graph image for getlionade.com.
 *
 * Next.js auto-wires this file as the OG image for `/`. Any unset
 * `openGraph.images` in metadata also falls through here, so children
 * routes without their own card still get a Lionade-branded preview
 * instead of the static CDN logo.
 *
 * Rendered on the Vercel edge — zero API cost, sub-second cold start.
 */
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og-card";

// `runtime` must be a string literal so Next's static analyzer can see
// it at build time. Don't refactor this into a const re-export.
export const runtime = "edge";
export const alt = "Lionade. Stop studying for free.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgCard({
    headline: "Stop studying for free.",
    subline:
      "Earn Fangs, climb ranks, duel friends, and master any exam with AI.",
    eyebrow: "Lionade",
  });
}
