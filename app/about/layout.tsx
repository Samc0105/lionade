import type { Metadata } from "next";

// Server-side metadata for a client-rendered page. The client `page.tsx`
// handles all interactivity; this layout exists solely to emit SEO tags
// that Next.js App Router can only collect from server components.
export const metadata: Metadata = {
  title: "About",
  description:
    "About Lionade — the Gen Z study-rewards app that turns studying into a game. Earn Fangs, master any exam, duel friends, climb the leaderboard.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About · Lionade",
    description:
      "About Lionade — the Gen Z study-rewards app. Earn Fangs, master any exam, duel friends, climb the leaderboard.",
    url: "https://getlionade.com/about",
    type: "website",
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
