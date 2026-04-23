import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Try the demo",
  description:
    "Try a free Lionade quiz demo — no sign-up needed. See how Lionade mixes AI-generated questions, rewards, and duels into a study experience you'll actually want to open.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Try the Lionade demo",
    description:
      "Free Lionade quiz demo — no sign-up. AI-generated questions, rewards, and duels.",
    url: absoluteUrl("/demo"),
    type: "website",
  },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
