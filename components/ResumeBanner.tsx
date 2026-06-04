"use client";

/**
 * ResumeBanner — sticky one-line banner that appears at the top of the
 * viewport whenever the user has an active session AND is currently on a
 * page that ISN'T that session's page.
 *
 * Example: user is in party room 1234 but navigated to /dashboard. We show:
 *   "Resume your party game →   [dismiss]"
 *   onClick → router.push('/games/party/1234')
 *
 * Per-session dismiss: a "session" here means an active_session pointer
 * (e.g. one party room visit). We key the dismissed sessionStorage flag by
 * `${type}:${id}` so:
 *   - Dismissing the banner for party room 1234 doesn't dismiss it for
 *     party room 5678 the user joins later.
 *   - Refreshing the tab keeps the dismiss state (sessionStorage persists
 *     across reloads within the same browser tab) so we don't nag.
 *   - Closing the tab clears the dismiss state (sessionStorage scope) —
 *     a fresh tab tomorrow re-shows the banner once.
 *
 * Z-index: Navbar is z-50. We render at z-[55] so we sit ABOVE the nav
 * (the nav is fixed top-0; without a higher z we'd disappear behind it
 * on pages where the nav has a backdrop-blur). The DemoModeBanner is
 * inline DOM ABOVE the Navbar, so render order is:
 *   ResumeBanner (z-55, fixed top)
 *   DemoModeBanner (inline, normal flow above Navbar)
 *   Navbar (fixed z-50)
 *
 * Precedence vs DemoModeBanner: both can be present (a demo user mid-
 * party-game). We let ResumeBanner sit visually above the DemoModeBanner
 * because the "resume" prompt is action-bearing (a missed click costs the
 * user gameplay state); the demo prompt is informational. The two banners
 * stack vertically, no overlap.
 *
 * Reduced-motion: respects `prefers-reduced-motion` via CSS transition: none
 * fallback. No JS-driven motion library — this is a CSS-only fade-in.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X } from "@phosphor-icons/react";
import {
  useActiveSession,
  urlForActiveSession,
  labelForActiveSession,
} from "@/lib/active-session";

const DISMISS_KEY_PREFIX = "lionade.resume-banner-dismissed:";

export default function ResumeBanner() {
  const { session } = useActiveSession();
  const router = useRouter();
  const pathname = usePathname() ?? "";

  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Per-session dismissal key. Memoised so we don't recompute on every render.
  const dismissKey = useMemo(() => {
    if (!session) return null;
    return `${DISMISS_KEY_PREFIX}${session.type}:${session.id}`;
  }, [session]);

  // Read the dismiss flag from sessionStorage when the session pointer
  // changes. A NEW session pointer (different id) automatically resets the
  // dismissed state because dismissKey is different => stored value is missing
  // => default state of `false` wins.
  useEffect(() => {
    setMounted(true);
    if (!dismissKey) {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(sessionStorage.getItem(dismissKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);

  // Avoid SSR/CSR mismatch.
  if (!mounted) return null;
  if (!session) return null;

  const targetUrl = urlForActiveSession(session);
  if (!targetUrl) return null;

  // The user is already on the session page — banner not needed.
  // Allow trailing-slash + query strings to still match.
  const onSessionPage = pathname === targetUrl || pathname.startsWith(`${targetUrl}/`) || pathname.startsWith(`${targetUrl}?`);
  if (onSessionPage) return null;

  if (dismissed) return null;

  const onResume = () => {
    router.push(targetUrl);
  };

  const onDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
    try {
      if (dismissKey) sessionStorage.setItem(dismissKey, "1");
    } catch {
      // sessionStorage can throw under strict privacy modes — we still
      // hide locally for this render. Worst case: re-shows after refresh.
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Resume active session"
      className="
        fixed top-0 left-0 right-0 z-[55]
        flex items-center justify-center gap-3 px-4 py-2
        text-xs sm:text-sm
        border-b border-[#FFD700]/30
        bg-[#0A0F1F]/92 backdrop-blur
        text-cream
        font-medium
        cursor-pointer
        transition-colors
        hover:bg-[#0A0F1F]/96
        motion-reduce:transition-none
      "
      onClick={onResume}
      style={{
        // Gold accent stripe on the left edge — design spec.
        boxShadow: "inset 4px 0 0 0 #FFD700",
      }}
    >
      <span className="truncate">
        <span className="font-bebas tracking-wider uppercase text-[11px] text-[#FFD700]/90 mr-2">
          Active
        </span>
        <span>{labelForActiveSession(session)}. </span>
        <span className="text-electric font-semibold underline-offset-4 hover:underline">
          Click to rejoin
        </span>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss resume prompt for this session"
        className="
          flex-shrink-0 p-1 rounded
          text-cream/60 hover:text-cream
          hover:bg-white/10
          transition-colors
          motion-reduce:transition-none
        "
      >
        <X size={14} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
