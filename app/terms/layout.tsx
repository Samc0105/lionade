import type { Metadata } from "next";
import { cdnUrl } from "@/lib/cdn";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = cdnUrl("/logo-full.png");

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for Lionade, the study-rewards app.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Terms of Service · Lionade",
    description: "Terms of Service for Lionade.",
    url: absoluteUrl("/terms"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Lionade Terms of Service" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Terms of Service · Lionade",
    description: "Terms of Service for Lionade.",
    images: [OG_IMAGE],
  },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
