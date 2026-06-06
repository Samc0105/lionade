import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = "https://d1745aj99cclbu.cloudfront.net/logo-full.png";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Lionade pricing. Free forever with ads, Pro at $6.99/mo with no popups, Platinum at $14.99/mo with zero ads and every feature unlocked.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing · Lionade",
    description:
      "Free forever. Pro $6.99/mo. Platinum $14.99/mo. Pick the plan that matches how hard you're grinding.",
    url: absoluteUrl("/pricing"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Lionade Pricing" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pricing · Lionade",
    description:
      "Free forever. Pro $6.99/mo. Platinum $14.99/mo. Pick the plan that matches how hard you're grinding.",
    images: [OG_IMAGE],
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
