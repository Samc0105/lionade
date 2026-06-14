"use client";

/**
 * Settings shell — shared chrome for every /settings/* route.
 *
 * Wraps ProtectedRoute + Navbar + SpaceBackground, renders the section nav
 * rail (LEFT on desktop, a horizontal scrollable pill row on mobile), and a
 * pending-deletion banner that surfaces whenever the account is scheduled for
 * deletion. The six section pages render into {children}.
 *
 * The nav rail's active state is pathname-driven (usePathname) so SSR and the
 * first client render produce the same tree; the limelight backdrop animates
 * its position between routes via framer-motion's shared layoutId. Reduced
 * motion collapses the spring to 0.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback } from "react";
import useSWR from "swr";
import { motion, useReducedMotion } from "framer-motion";
import {
  User as UserIcon,
  Lock,
  Bell,
  ChartBar,
  Crown,
  Palette,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import { apiGet, apiPost } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";

const SECTIONS: { href: string; label: string; Icon: Icon; danger?: boolean }[] = [
  { href: "/settings/account", label: "Account", Icon: UserIcon },
  { href: "/settings/appearance", label: "Appearance", Icon: Palette },
  { href: "/settings/privacy", label: "Privacy", Icon: Lock },
  { href: "/settings/notifications", label: "Notifications", Icon: Bell },
  { href: "/settings/data", label: "Data & Usage", Icon: ChartBar },
  { href: "/settings/subscription", label: "Subscription", Icon: Crown },
  { href: "/settings/danger", label: "Danger Zone", Icon: Warning, danger: true },
];

// Account-state shape returned by GET /api/user/account.
//
// TODO(backend): the GET handler on /api/user/account is being added by the
// account agent alongside the scheduled-deletion flow. It should return
// `pending_deletion_at` (ISO string | null) read from profiles. Until that
// ships, swrFetcher returns ok:false and the banner simply stays hidden — no
// crash, no false-positive banner.
interface AccountState {
  pending_deletion_at: string | null;
}

function PendingDeletionBanner() {
  // Lightweight poll-free fetch of the account state. revalidateOnFocus keeps
  // it fresh if the user schedules / cancels deletion in another tab.
  const { data, mutate } = useSWR(
    "settings/account-state",
    () => apiGet<AccountState>("/api/user/account"),
    { revalidateOnFocus: true, keepPreviousData: true },
  );

  const pendingAt =
    data?.ok && data.data ? data.data.pending_deletion_at : null;

  const cancelDeletion = useCallback(async () => {
    // Optimistic hide: clear the local cache immediately, then confirm with
    // the server. On failure, revalidate so the banner reappears.
    void mutate(
      (prev) =>
        prev && prev.ok && prev.data
          ? { ...prev, data: { ...prev.data, pending_deletion_at: null } }
          : prev,
      { revalidate: false },
    );
    const res = await apiPost("/api/user/account/cancel-deletion", {});
    if (!res.ok) {
      toastError("Couldn't cancel the deletion. Try again.");
      void mutate(); // re-fetch — banner comes back if still scheduled
      return;
    }
    toastSuccess("Account deletion cancelled. You're all set.");
    void mutate();
  }, [mutate]);

  if (!pendingAt) return null;

  const dateLabel = (() => {
    const d = new Date(pendingAt);
    return isNaN(d.getTime())
      ? "soon"
      : d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
  })();

  return (
    <div
      role="alert"
      className="mb-6 rounded-2xl border border-red-500/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-slide-up transform-gpu"
      style={{
        background:
          "linear-gradient(135deg, rgba(40,13,16,0.6), rgba(28,10,12,0.6))",
      }}
    >
      <div className="flex items-start gap-3 min-w-0">
        <Warning
          size={20}
          weight="fill"
          className="text-red-300 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-red-200 text-sm font-semibold leading-tight">
            Your account is scheduled for deletion on {dateLabel}.
          </p>
          <p className="text-red-200/55 text-xs mt-1 leading-snug">
            Cancel any time before then to keep your account and all your data.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={cancelDeletion}
        className="flex-shrink-0 self-start sm:self-center inline-flex items-center px-4 py-2 rounded-lg text-xs font-bold text-red-100 bg-red-500/20 border border-red-400/40 hover:bg-red-500/30 hover:border-red-400/60 transition-colors transform-gpu"
      >
        Cancel deletion
      </button>
    </div>
  );
}

function SettingsNav() {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  const isActive = (href: string) =>
    pathname === href || (pathname?.startsWith(href + "/") ?? false);

  return (
    <>
      {/* Desktop: vertical rail, sticky beneath the navbar. */}
      <nav
        aria-label="Settings sections"
        className="hidden lg:block sticky top-20 self-start"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/35 mb-3 pl-3">
          Settings
        </p>
        <ul className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => {
            const active = isActive(s.href);
            return (
              <li key={s.href} className="relative">
                <Link
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center gap-2.5 pl-3 pr-4 py-2 text-[13px] font-semibold rounded-lg transition-colors duration-200 ${
                    active
                      ? s.danger
                        ? "text-red-200"
                        : "text-cream"
                      : s.danger
                        ? "text-red-300/55 hover:text-red-300/80"
                        : "text-cream/45 hover:text-cream/80"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="settingsNavLimelight"
                      aria-hidden="true"
                      className="settings-limelight absolute inset-0 rounded-lg"
                      style={
                        {
                          // Accent injected per-row: red ONLY on Danger, so the
                          // red glow can never bleed onto a non-danger section.
                          "--limelight": s.danger ? "239, 68, 68" : "74, 144, 217",
                        } as React.CSSProperties
                      }
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 380, damping: 32 }
                      }
                    />
                  )}
                  <s.Icon
                    size={16}
                    weight={active ? "fill" : "regular"}
                    className="relative z-10 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="relative z-10">{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Mobile: horizontal scrollable pill row. */}
      <nav
        aria-label="Settings sections"
        className="lg:hidden -mx-4 px-4 mb-6 overflow-x-auto no-scrollbar"
      >
        <ul className="flex items-center gap-2 w-max">
          {SECTIONS.map((s) => {
            const active = isActive(s.href);
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-200 transform-gpu ${
                    active
                      ? s.danger
                        ? "text-red-200"
                        : "text-cream"
                      : s.danger
                        ? "text-red-300/60 hover:text-red-300/85"
                        : "text-cream/55 hover:text-cream/85"
                  }`}
                >
                  {active ? (
                    <motion.span
                      layoutId="settingsNavLimelightPill"
                      aria-hidden="true"
                      className="settings-limelight-pill absolute inset-0 rounded-full"
                      style={
                        {
                          "--limelight": s.danger ? "239, 68, 68" : "74, 144, 217",
                        } as React.CSSProperties
                      }
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 420, damping: 34 }
                      }
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-white/[0.03] border border-white/[0.06]"
                    />
                  )}
                  <s.Icon
                    size={14}
                    weight={active ? "fill" : "regular"}
                    aria-hidden="true"
                    className="relative z-10"
                  />
                  <span className="relative z-10">{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy text-cream pt-12">
        <SpaceBackground />
        <Navbar />

        <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 pt-8 pb-24">
          {/* Header */}
          <header className="mb-8 animate-slide-up transform-gpu">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-block w-6 h-px bg-gold/70"
                aria-hidden="true"
              />
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/45 leading-none">
                Your control panel
              </p>
            </div>
            <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider leading-none">
              SETTINGS
            </h1>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8 lg:gap-12">
            <SettingsNav />

            <div className="min-w-0">
              <PendingDeletionBanner />
              {children}
            </div>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
