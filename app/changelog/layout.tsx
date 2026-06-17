import type { Metadata } from "next";
import { cdnUrl } from "@/lib/cdn";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = cdnUrl("/logo-full.png");

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "What we ship at Lionade, in chronological order. New features, polish, fixes, and infra updates. We ship daily.",
  alternates: { canonical: "/changelog" },
  openGraph: {
    title: "Changelog · Lionade",
    description:
      "What we ship at Lionade, in chronological order. We ship daily. Here is what changed.",
    url: absoluteUrl("/changelog"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Lionade Changelog" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Changelog · Lionade",
    description:
      "What we ship at Lionade, in chronological order. We ship daily.",
    images: [OG_IMAGE],
  },
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
