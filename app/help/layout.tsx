import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = "https://d1745aj99cclbu.cloudfront.net/logo-full.png";

export const metadata: Metadata = {
  title: "Help Center · Lionade",
  description:
    "Answers to common questions about Lionade. Learn how Fangs work, how to play games, how to use Mastery Mode, and how to manage your account.",
  alternates: { canonical: "/help" },
  openGraph: {
    title: "Help Center · Lionade",
    description:
      "Quick answers about Fangs, games, Mastery Mode, accounts, pricing, and privacy on Lionade.",
    url: absoluteUrl("/help"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Lionade Help Center" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Help Center · Lionade",
    description:
      "Quick answers about Fangs, games, Mastery Mode, accounts, pricing, and privacy on Lionade.",
    images: [OG_IMAGE],
  },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
