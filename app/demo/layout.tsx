import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try the demo",
  description:
    "Try a free Lionade quiz demo — no sign-up needed. See how Lionade mixes AI-generated questions, rewards, and duels into a study experience you'll actually want to open.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Try the Lionade demo",
    description:
      "Free Lionade quiz demo — no sign-up. AI-generated questions, rewards, and duels.",
    url: "https://getlionade.com/demo",
    type: "website",
  },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
