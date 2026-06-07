import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = "https://d1745aj99cclbu.cloudfront.net/logo-full.png";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "The Lionade blog. Certification study plans, retention science, and the workflows behind earning Fangs for studying.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Blog · Lionade",
    description:
      "Certification study plans, retention science, and the workflows behind earning Fangs for studying.",
    url: absoluteUrl("/blog"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Lionade Blog" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Blog · Lionade",
    description:
      "Certification study plans, retention science, and the workflows behind earning Fangs for studying.",
    images: [OG_IMAGE],
  },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
