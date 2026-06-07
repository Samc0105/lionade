import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-config";

const OG_IMAGE = "https://d1745aj99cclbu.cloudfront.net/logo-full.png";

export const metadata: Metadata = {
  title: "Try the Lionade quiz",
  description:
    "Free 5-question Lionade quiz, no sign-up. See how the timed multiple-choice format feels before you make an account.",
  alternates: { canonical: "/demo/quiz" },
  openGraph: {
    title: "Try the Lionade quiz",
    description:
      "Free 5-question Lionade quiz, no sign-up. See how the timed format feels.",
    url: absoluteUrl("/demo/quiz"),
    siteName: "Lionade",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Try the Lionade quiz" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Try the Lionade quiz",
    description:
      "Free 5-question Lionade quiz, no sign-up.",
    images: [OG_IMAGE],
  },
};

export default function DemoQuizLayout({ children }: { children: React.ReactNode }) {
  return children;
}
