import type { Metadata } from "next";
import { cdnUrl } from "@/lib/cdn";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = cdnUrl("/logo-full.png");

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Lionade Privacy Policy. How we collect, store, and use your data when you study with us.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Privacy Policy · Lionade",
    description: "How Lionade collects, stores, and uses your data.",
    url: absoluteUrl("/privacy"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Lionade Privacy Policy" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy Policy · Lionade",
    description: "How Lionade collects, stores, and uses your data.",
    images: [OG_IMAGE],
  },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
