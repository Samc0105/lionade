import type { Metadata } from "next";
import { Bebas_Neue, Syne, DM_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AuthProviderWrapper from "@/components/AuthProviderWrapper";
import SpaceBackground from "@/components/SpaceBackground";
import SakuraPetals from "@/components/SakuraPetals";
import ThemeProvider from "@/components/ThemeProvider";
import { ToastProvider } from "@/components/Toast";
import StructuredData from "@/components/StructuredData";
import { SITE_URL, SITE_URL_OBJ } from "@/lib/site-config";

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

// Root-level SEO + brand signal. Every field here exists to tell search
// engines that "Lionade" is a distinct product — Google currently mis-
// corrects "lionade" → "lemonade" because our brand signal is weak.
//
// `metadataBase` lets Next.js expand relative URLs (OG images, canonicals)
// into absolute ones on prod.
// `title.template` means every child page gets "<page> · Lionade" for free
// unless it sets its own `title.absolute`.
export const metadata: Metadata = {
  metadataBase: SITE_URL_OBJ,
  title: {
    default: "Lionade — Study Like It's Your Job",
    template: "%s · Lionade",
  },
  applicationName: "Lionade",
  description:
    "Stop studying for free. Earn Fangs, climb ranks, get paid.",
  keywords: [
    "Lionade",
    "Lionade app",
    "Lionade study",
    "study rewards",
    "study app",
    "AI tutor",
    "exam prep",
    "mastery mode",
    "cert exam prep",
    "gamified learning",
    "quiz app",
    "AP exams",
    "AWS certification",
    "SAT prep",
  ],
  authors: [{ name: "Lionade", url: SITE_URL }],
  creator: "Lionade",
  publisher: "Lionade",
  category: "education",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Lionade — Study Like It's Your Job",
    description: "Stop studying for free. Earn Fangs, climb ranks, get paid.",
    url: SITE_URL,
    siteName: "Lionade",
    // Served from our CloudFront CDN so the preview card loads fast on
    // iMessage, Slack, Discord, etc. 1200×630 is the size every major
    // platform uses for its large-card layout.
    images: [{
      url: "https://d1745aj99cclbu.cloudfront.net/logo-full.png",
      width: 1200,
      height: 630,
      alt: "Lionade — Study Like It's Your Job",
    }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lionade — Study Like It's Your Job",
    description: "Stop studying for free. Earn Fangs, climb ranks, get paid.",
    images: ["https://d1745aj99cclbu.cloudfront.net/logo-full.png"],
    creator: "@lionade",
    site: "@lionade",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // Google Search Console site-ownership verification for
    // getlionade.com. Tied to Sam's Search Console account.
    google: "TWs2aoIbK3JUZiAz61rqLuWWowiVHewk6das8GL6US4",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${bebasNeue.variable} ${syne.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var d=document.documentElement;var t=localStorage.getItem("theme")||"dark";d.dataset.theme=t;d.dataset.fontSize=localStorage.getItem("fontSize")||"medium";if(t==="light")d.classList.add("light")}catch(e){}})()` }} />
      </head>
      <body className="text-cream font-syne antialiased">
        <StructuredData />
        <ThemeProvider>
          <SpaceBackground />
          <SakuraPetals />
          <div className="relative z-10 layout-content-bg">
            <AuthProviderWrapper>
              <ToastProvider>
                <Navbar />
                <main>{children}</main>
                <Footer />
              </ToastProvider>
            </AuthProviderWrapper>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
