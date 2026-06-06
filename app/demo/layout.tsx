import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = "https://d1745aj99cclbu.cloudfront.net/logo-full.png";

export const metadata: Metadata = {
  title: "Try the demo",
  description:
    "Try a free Lionade quiz demo, no sign-up needed. AI-generated questions, rewards, and duels in a study experience you'll actually want to open.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Try the Lionade demo",
    description:
      "Free Lionade quiz demo, no sign-up. AI-generated questions, rewards, and duels.",
    url: absoluteUrl("/demo"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Try the Lionade demo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Try the Lionade demo",
    description:
      "Free Lionade quiz demo, no sign-up. AI-generated questions, rewards, and duels.",
    images: [OG_IMAGE],
  },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
