"use client";

/**
 * Demo-mode banner — shown at the top of every page when the signed-in
 * user is the shared demo account (demo@getlionade.com).
 *
 * Behavior:
 *   - Renders nothing for real users (most common case — no work, no DOM).
 *   - Dismissable per session via sessionStorage so testers can hide it
 *     mid-session. Re-appears on next session.
 *   - "Create your own account" link routes to /login?signup=true so the
 *     login page can pop the Sign Up tab on mount (the login page already
 *     has a tab switcher; the param is a hint that may or may not get
 *     consumed — non-essential).
 *   - Mounted INSIDE the AuthProvider tree (root layout) so we have access
 *     to `useAuth()`. Sits just above the Navbar.
 *
 * Styling intentionally muted (cream/40, no animation) — the goal is a
 * gentle reminder, not a takeover.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import { isDemoUser } from "@/lib/demo-guard";

const DISMISS_KEY = "lionade.demo-banner-dismissed";

export default function DemoModeBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") {
        setDismissed(true);
      }
    } catch {
      // sessionStorage can throw under strict privacy modes — just render
      // the banner. Worst case is a tester sees it every page nav.
    }
  }, []);

  // Avoid SSR/CSR mismatch — only render after first client paint.
  if (!mounted) return null;
  if (!user || !isDemoUser(user.id)) return null;
  if (dismissed) return null;

  const onDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore — UI state already dismissed for this render cycle
    }
  };

  return (
    <div
      role="status"
      aria-label="Demo account notice"
      className="w-full flex items-center justify-center gap-3 px-4 py-2 text-xs sm:text-sm border-b border-electric/15 bg-electric/5 text-cream/70 font-medium"
    >
      <span className="truncate">
        You&apos;re trying the demo account. Want to save your progress?{" "}
        <Link
          href="/login?signup=true"
          className="text-electric font-semibold hover:text-electric/80 underline-offset-4 hover:underline"
        >
          Create your own account
        </Link>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss demo notice for this session"
        className="flex-shrink-0 p-1 rounded text-cream/50 hover:text-cream/90 hover:bg-white/5 transition-colors"
      >
        <X size={14} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
