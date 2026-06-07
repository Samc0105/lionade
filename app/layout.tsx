import type { Metadata } from "next";
import { Bebas_Neue, Syne, DM_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import AuthProviderWrapper from "@/components/AuthProviderWrapper";
import SwrProvider from "@/components/SwrProvider";
import SpaceBackground from "@/components/SpaceBackground";
import SakuraPetals from "@/components/SakuraPetals";
import ThemeProvider from "@/components/ThemeProvider";
import { ToastProvider } from "@/components/Toast";
import StructuredData from "@/components/StructuredData";
import QuickNoteShortcut from "@/components/QuickNoteShortcut";
import FocusMusicToggle from "@/components/FocusMusicToggle";
import FocusLockIn from "@/components/FocusLockIn";
import LaunchDock from "@/components/LaunchDock";
import PageTransition from "@/components/PageTransition";
import DemoModeBanner from "@/components/DemoModeBanner";
import ResumeBanner from "@/components/ResumeBanner";
import SessionLifecycle from "@/components/SessionLifecycle";
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
// engines that "Lionade" is a distinct product. Google currently mis-
// corrects "lionade" to "lemonade" because our brand signal is weak.
//
// `metadataBase` lets Next.js expand relative URLs (OG images, canonicals)
// into absolute ones on prod.
// `title.template` means every child page gets "<page> · Lionade" for free
// unless it sets its own `title.absolute`.
export const metadata: Metadata = {
  metadataBase: SITE_URL_OBJ,
  title: {
    default: "Lionade · Study Like It's Your Job",
    template: "%s · Lionade",
  },
  applicationName: "Lionade",
  appleWebApp: {
    // Powers iOS "Add to Home Screen". `capable` enables standalone mode
    // (no Safari chrome). `title` is the label under the home-screen icon.
    // `black-translucent` lets the app paint under the status bar so the
    // dark theme reads edge-to-edge on pinned launches.
    capable: true,
    title: "Lionade",
    statusBarStyle: "black-translucent",
  },
  description:
    "Lionade (not lemonade) is the study-rewards app for Gen Z. Earn Fangs, climb ranks, duel friends, and master any exam with AI.",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
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
    // Multi-resolution favicon set. `icon` array order matters: browsers
    // pick the first one whose declared size matches their display DPI.
    // favicon.ico is a multi-image ICO containing 16/32/48/192 so legacy
    // UAs (Chrome autofill, RSS readers, Edge pinned sites) pick the right
    // one without extra network requests.
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    shortcut: "/favicon.ico",
  },
  openGraph: {
    title: "Lionade · Study Like It's Your Job",
    description: "Stop studying for free. Earn Fangs, climb ranks, duel friends, and master any exam with AI.",
    url: SITE_URL,
    siteName: "Lionade",
    // Served from our CloudFront CDN so the preview card loads fast on
    // iMessage, Slack, Discord, etc. 1200x630 is the size every major
    // platform uses for its large-card layout.
    images: [{
      url: "https://d1745aj99cclbu.cloudfront.net/logo-full.png",
      width: 1200,
      height: 630,
      alt: "Lionade · Study Like It's Your Job",
    }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lionade · Study Like It's Your Job",
    description: "Stop studying for free. Earn Fangs, climb ranks, duel friends, and master any exam with AI.",
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
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[1000] focus:px-4 focus:py-2 focus:rounded-md focus:bg-gold focus:text-navy focus:font-semibold focus:shadow-lg"
        >
          Skip to main content
        </a>
        <StructuredData />
        <ThemeProvider>
          <SpaceBackground />
          <SakuraPetals />
          <div className="relative z-10 layout-content-bg">
            <SwrProvider>
              <AuthProviderWrapper>
                <ToastProvider>
                  {/* ResumeBanner is fixed-position z-[55] (above Navbar).
                      SessionLifecycle is the per-user realtime listener (no
                      DOM, just side effects). Both must be inside ToastProvider
                      because SessionLifecycle calls useToast() for soft
                      cross-game-redirect confirmations on mid-question pages. */}
                  <SessionLifecycle />
                  <ResumeBanner />
                  <DemoModeBanner />
                  <Navbar />
                  <main id="main-content">
                    <PageTransition>{children}</PageTransition>
                  </main>
                  <QuickNoteShortcut />
                  <FocusMusicToggle />
                  <FocusLockIn />
                  <LaunchDock />
                </ToastProvider>
              </AuthProviderWrapper>
            </SwrProvider>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
