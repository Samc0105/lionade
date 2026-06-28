import type { Metadata } from "next";
import { cdnUrl } from "@/lib/cdn";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = cdnUrl("/logo-full.png");

export const metadata: Metadata = {
  title: "Security and Vulnerability Disclosure",
  description: "How to report a security vulnerability in Lionade, what is in scope, and our safe-harbor commitment to good-faith researchers.",
  alternates: { canonical: "/security" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Security · Lionade",
    description: "Report a vulnerability in Lionade. Scope, safe harbor, and how we respond.",
    url: absoluteUrl("/security"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Lionade Security Policy" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Security · Lionade",
    description: "Report a vulnerability in Lionade. Scope, safe harbor, and how we respond.",
    images: [OG_IMAGE],
  },
};

export default function SecurityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
