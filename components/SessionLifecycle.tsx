"use client";

/**
 * SessionLifecycle — the cross-game redirect listener.
 *
 * Mounted once inside AuthProviderWrapper (so it has `useAuth()`) and the
 * ToastProvider (so we can surface toasts when needed). Subscribes to the
 * per-user realtime channel `user:<userId>` and listens for the
 * `active_session_changed` event. When a new active_session comes in:
 *
 *   - If the new session points to a different URL than the user is
 *     currently viewing → router.replace(newUrl).
 *   - Skip the redirect when the user is on /login or auth pages.
 *   - Skip the redirect when the user has dismissed the banner for that
 *     specific session id (we don't want to yank them in if they
 *     deliberately dismissed).
 *   - Confirm with the user before yanking them out of a mid-question
 *     surface (Mastery, Quiz, Arena match) — we use a soft toast with an
 *     action button instead of a hard redirect.
 *
 * The server-side broadcast happens in the backend's set_active_session
 * RPC and party-room start-game route. Trust contract: event name +
 * payload shape are the source of truth.
 */

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  useActiveSession,
  urlForActiveSession,
  type ActiveSession,
} from "@/lib/active-session";
import { useToast } from "@/components/Toast";

// Paths where we never auto-redirect (auth + onboarding flows).
const REDIRECT_SAFE_LIST = [
  "/login",
  "/signup",
  "/onboarding",
  "/forgot-password",
  "/reset-password",
];

// Paths where we treat the user as "mid-something-important" — we'll show
// a soft toast with a CTA instead of yanking them out. The user can choose
// to switch.
const SOFT_CONFIRM_PREFIXES = [
  "/quiz/",
  "/learn/mastery/",
  "/compete/arena/",
];

const DISMISS_KEY_PREFIX = "lionade.resume-banner-dismissed:";

function shouldSkipRedirect(pathname: string): boolean {
  return REDIRECT_SAFE_LIST.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function shouldSoftConfirm(pathname: string): boolean {
  return SOFT_CONFIRM_PREFIXES.some((p) => pathname.startsWith(p));
}

function isDismissed(session: ActiveSession): boolean {
  try {
    return sessionStorage.getItem(`${DISMISS_KEY_PREFIX}${session.type}:${session.id}`) === "1";
  } catch {
    return false;
  }
}

export default function SessionLifecycle() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { session, mutate } = useActiveSession();
  const { toast } = useToast();

  // Stash live values in refs so the realtime callback closure doesn't go
  // stale when pathname / session change without re-subscribing.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const sessionRef = useRef<ActiveSession | null>(session);
  sessionRef.current = session;

  // ── Per-user realtime channel for cross-game redirects ──
  useEffect(() => {
    if (!user?.id) return;

    const channelName = `user:${user.id}`;
    const channel = supabase
      .channel(channelName)
      .on("broadcast", { event: "active_session_changed" }, (msg: { payload?: unknown }) => {
        const payload = (msg.payload ?? {}) as { active_session?: ActiveSession | null };
        const newSession = payload.active_session ?? null;
        // Refresh the SWR-backed pointer so every other consumer
        // (ActiveSessionToast, reconnect-on-mount guard) picks up the new value
        // even if SWR's 30s poll hasn't fired.
        void mutate();

        if (!newSession) {
          // The server cleared the active_session (e.g. user was reaped
          // for AFK). Don't yank them anywhere — let the page they're on
          // detect via useActiveSession on its own.
          return;
        }

        const currentPath = pathnameRef.current;
        if (shouldSkipRedirect(currentPath)) return;
        if (isDismissed(newSession)) return;

        const targetUrl = urlForActiveSession(newSession);
        if (!targetUrl) return;

        // Already there.
        if (currentPath === targetUrl || currentPath.startsWith(`${targetUrl}/`)) return;

        if (shouldSoftConfirm(currentPath)) {
          // Don't yank a user mid-question — surface a toast with a CTA.
          toast("Your party is starting a new game", {
            type: "info",
            duration: 8000,
            action: {
              label: "Join now",
              onClick: () => router.replace(targetUrl),
            },
          });
          return;
        }

        // Default path: hard redirect.
        router.replace(targetUrl);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // Re-subscribe only when the user id changes. router / mutate / toast
    // are stable enough that we don't want to rebuild the channel on
    // every re-render (which would flap subscriptions and miss events).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return null;
}
