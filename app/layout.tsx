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
import ActiveSessionToast from "@/components/ActiveSessionToast";
import SessionLifecycle from "@/components/SessionLifecycle";
import TeamGate from "@/components/TeamGate";
import MaintenanceGate from "@/components/MaintenanceGate";
import MaintenanceStatusBanner from "@/components/MaintenanceStatusBanner";
import PartyInviteToast from "@/components/party/PartyInviteToast";
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
    // No explicit `images` — Next.js auto-wires `app/opengraph-image.tsx`
    // (and per-route `app/<route>/opengraph-image.tsx`) as the share card.
    // Setting `images` here would override that auto-wiring at the root
    // scope and force every page back to a static CDN PNG. The dynamic
    // edge-rendered cards are higher engagement, so we let convention win.
    locale: "en_US",
    type: "website",
  },
  twitter: {
    // Keep the large-image card so link previews still render on X, but omit
    // creator/site @handles — there is no live account yet, and a dead handle
    // attribution hurts more than it helps. Add back when an account exists.
    card: "summary_large_image",
    title: "Lionade · Study Like It's Your Job",
    description: "Stop studying for free. Earn Fangs, climb ranks, duel friends, and master any exam with AI.",
    // Same logic as openGraph above: omit `images` so `twitter-image.tsx`
    // takes over per-route.
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
                  {/* SessionLifecycle is the per-user realtime listener (no
                      DOM, just side effects). It must be inside ToastProvider
                      because it calls useToast() for soft cross-game-redirect
                      confirmations on mid-question pages. */}
                  <SessionLifecycle />
                  {/* TeamGate forces staff through the password / TOTP
                      onboarding flow. Zero-network for normal users (reads
                      session user_metadata); only mfa_required accounts ever
                      call listFactors, cached once per session. Renders
                      nothing. Sits beside SessionLifecycle, inside the auth
                      provider so it has useAuth(). */}
                  <TeamGate />
                  <DemoModeBanner />
                  <Navbar />
                  <main id="main-content">
                    {/* Global status banner. Slim, dismissible, informational
                        bar that lists ANY feature in effective warning /
                        maintenance on every normal page. Sits ABOVE the
                        MaintenanceGate body so it shows on live pages; it never
                        blocks. Fail-open (renders nothing when no flags). */}
                    <MaintenanceStatusBanner />
                    {/* Site-wide kill-switch. Reads the "site" feature flag
                        and, when in maintenance, swaps the page body for the
                        brand MaintenanceState for non-staff. Staff bypass so an
                        admin can still reach /admin to lift the flag. Sits
                        inside ToastProvider and OUTSIDE the Navbar so the nav
                        (a recovery surface) is never hidden. Fail-open. */}
                    <MaintenanceGate>
                      <PageTransition>{children}</PageTransition>
                    </MaintenanceGate>
                  </main>
                  <QuickNoteShortcut />
                  <FocusMusicToggle />
                  <FocusLockIn />
                  <LaunchDock />
                  {/* Global party-invite banner. Listens to the invite bus
                      (fed by Navbar's notifications Realtime channel) so an
                      invite surfaces instantly on any page. Renders nothing
                      while logged out or idle. */}
                  <PartyInviteToast />
                  {/* Active-session resume toast (replaces the old sticky
                      ResumeBanner top bar). Slides in from the right at
                      top-40 / z-[65] so it never collides with the
                      top-centered PartyInviteToast (top-20, z-[70]) or the
                      bottom-right ToastViewport (z-[60]). */}
                  <ActiveSessionToast />
                </ToastProvider>
              </AuthProviderWrapper>
            </SwrProvider>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
