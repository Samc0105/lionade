import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with the Lionade team. Product feedback, bug reports, business questions — support@getlionade.com.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact Lionade",
    description: "Get in touch with the Lionade team.",
    url: "https://getlionade.com/contact",
    type: "website",
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
