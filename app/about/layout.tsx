import type { Metadata } from "next";
import { cdnUrl } from "@/lib/cdn";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = cdnUrl("/logo-full.png");

// Server-side metadata for a client-rendered page. The client `page.tsx`
// handles all interactivity; this layout exists solely to emit SEO tags
// that Next.js App Router can only collect from server components.
export const metadata: Metadata = {
  title: "About",
  description:
    "About Lionade (not lemonade), the Gen Z study-rewards app that turns studying into a game. Earn Fangs, master any exam, duel friends, climb the leaderboard.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About · Lionade",
    description:
      "Lionade is the Gen Z study-rewards app. Earn Fangs, master any exam, duel friends, climb the leaderboard.",
    url: absoluteUrl("/about"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "About Lionade" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "About · Lionade",
    description:
      "Lionade is the Gen Z study-rewards app. Earn Fangs, master any exam, duel friends, climb the leaderboard.",
    images: [OG_IMAGE],
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
