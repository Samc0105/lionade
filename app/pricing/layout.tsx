import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Lionade pricing — Free forever with ads, Pro at $6.99/mo with no popups, Platinum at $14.99/mo with zero ads and every feature unlocked.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing · Lionade",
    description:
      "Free forever · Pro $6.99/mo · Platinum $14.99/mo. Pick the plan that matches how hard you're grinding.",
    url: absoluteUrl("/pricing"),
    type: "website",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
