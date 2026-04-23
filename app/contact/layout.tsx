import type { Metadata } from "next";
import { SUPPORT_EMAIL, absoluteUrl } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Contact",
  description:
    `Get in touch with the Lionade team. Product feedback, bug reports, business questions — ${SUPPORT_EMAIL}.`,
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact Lionade",
    description: "Get in touch with the Lionade team.",
    url: absoluteUrl("/contact"),
    type: "website",
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
