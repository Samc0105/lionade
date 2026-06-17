import type { Metadata } from "next";
import { cdnUrl } from "@/lib/cdn";
import { SUPPORT_EMAIL, absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = cdnUrl("/logo-full.png");

export const metadata: Metadata = {
  title: "Contact",
  description:
    `Get in touch with the Lionade team. Product feedback, bug reports, business questions: ${SUPPORT_EMAIL}.`,
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact Lionade",
    description: "Get in touch with the Lionade team.",
    url: absoluteUrl("/contact"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Contact Lionade" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Contact Lionade",
    description: "Get in touch with the Lionade team.",
    images: [OG_IMAGE],
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
