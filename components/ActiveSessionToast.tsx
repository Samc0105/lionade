"use client";

/**
 * ActiveSessionToast — replaces the old persistent ResumeBanner top bar.
 *
 * A slide-in-from-the-RIGHT toast that appears when the user has an active
 * session pointer (party room, arena match, mastery sitting, daily drill,
 * quiz) and is NOT currently on that session's page. Party copy:
 *
 *   "You have an active party"   [Rejoin] [Dismiss]
 *
 * Behavior contract (spec'd 2026-06):
 *   - Auto-vanishes after 5s. Auto-vanish does NOT suppress future shows:
 *     navigating to another page re-shows the toast (fresh 5s timer).
 *   - Explicit Dismiss is session-scoped: a sessionStorage flag keyed by
 *     `${type}:${id}` (room code for parties) suppresses the toast for the
 *     rest of the browser session for THAT session only. A new room code
 *     gets a fresh flag. Unlike the old banner, Dismiss does NOT delete the
 *     server-side active_session pointer; the pointer keeps serving the
 *     reconnect-on-mount guards and the 2h staleness reaper handles cleanup.
 *   - Suppressed while the user is already inside the session's page.
 *   - Hover/focus pauses the 5s timer (two actions need reachable time).
 *
 * Anchoring / collision:
 *   - PartyInviteToast: fixed top-20, centered, z-[70].
 *   - Global ToastViewport: fixed bottom-right, z-[60].
 *   - This toast: fixed top-40 right-4, z-[65] — vertically below the invite
 *     toast band at every viewport width, clear of the bottom-right stack.
 *
 * Motion: GPU-only (translate3d + opacity) slide-in from the right using the
 * Toast.tsx two-frame rAF commit trick. prefers-reduced-motion renders
 * instantly with no transition.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  useActiveSession,
  urlForActiveSession,
  type ActiveSession,
} from "@/lib/active-session";

const AUTO_VANISH_MS = 5000;
const EXIT_MS = 200;
const DISMISS_KEY_PREFIX = "lionade.resume-toast-dismissed:";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function headlineFor(session: ActiveSession): string {
  switch (session.type) {
    case "party_room":
      return "You have an active party";
    case "mastery_session":
      return "You have an active Mastery session";
    case "arena_match":
    case "competitive_match":
      return "You have an active arena match";
    case "daily_drill":
      return "You have an active daily drill";
    case "quiz":
      return "You have an active quiz";
    default:
      return "You have an active session";
  }
}

function actionLabelFor(session: ActiveSession): string {
  // Multiplayer surfaces are re-JOINED; solo surfaces are resumed.
  switch (session.type) {
    case "party_room":
    case "arena_match":
    case "competitive_match":
      return "Rejoin";
    default:
      return "Resume";
  }
}

export default function ActiveSessionToast() {
  const { session } = useActiveSession();
  const router = useRouter();
  const pathname = usePathname() ?? "";

  const [mounted, setMounted] = useState(false);
  /** Explicit Dismiss — sessionStorage-backed, per session pointer. */
  const [dismissed, setDismissed] = useState(false);
  /** Auto-vanish — local only, reset on every pathname change. */
  const [autoHidden, setAutoHidden] = useState(false);

  const dismissKey = useMemo(() => {
    if (!session) return null;
    return `${DISMISS_KEY_PREFIX}${session.type}:${session.id}`;
  }, [session]);

  // Hydrate the explicit-dismiss flag whenever the session pointer changes.
  // A NEW pointer (different room code) has a different key, so the stored
  // value is missing and the toast is eligible again.
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

  // Auto-vanish is per page-view: navigating anywhere re-arms the toast
  // (the layout-mounted component never remounts on route change, so we
  // reset on pathname instead).
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;
    setAutoHidden(false);
  }, [pathname]);

  const onDismiss = useCallback(() => {
    setDismissed(true);
    try {
      if (dismissKey) sessionStorage.setItem(dismissKey, "1");
    } catch {
      // Strict privacy modes can throw; we still hide for this render.
    }
  }, [dismissKey]);

  const onAutoVanish = useCallback(() => {
    setAutoHidden(true);
  }, []);

  // Avoid SSR/CSR mismatch.
  if (!mounted || !session) return null;

  const targetUrl = urlForActiveSession(session);
  if (!targetUrl) return null;

  // Already on the session page (trailing slash / query tolerated)? No toast.
  const onSessionPage =
    pathname === targetUrl ||
    pathname.startsWith(`${targetUrl}/`) ||
    pathname.startsWith(`${targetUrl}?`);
  if (onSessionPage || dismissed || autoHidden) return null;

  const onRejoin = () => {
    // Navigation flips onSessionPage above, which unmounts the card; the
    // pathname-change effect re-arms autoHidden for future pages.
    router.push(targetUrl);
  };

  return (
    <ToastCard
      // Re-mount per session pointer AND per page-view so the slide-in
      // replays and the 5s timer restarts after every navigation re-show.
      key={`${session.type}:${session.id}:${pathname}`}
      session={session}
      onRejoin={onRejoin}
      onDismiss={onDismiss}
      onAutoVanish={onAutoVanish}
    />
  );
}

function ToastCard({
  session,
  onRejoin,
  onDismiss,
  onAutoVanish,
}: {
  session: ActiveSession;
  onRejoin: () => void;
  onDismiss: () => void;
  onAutoVanish: () => void;
}) {
  const reduced = prefersReducedMotion();

  // Two-frame rAF commit (Toast.tsx pattern): paint at the off-screen
  // transform first, flip visible on the next frame so the transition runs.
  const [entered, setEntered] = useState<boolean>(reduced);
  useEffect(() => {
    if (reduced) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [reduced]);

  /** "auto" plays the exit then reports auto-vanish; "dismiss" the same for Dismiss. */
  const [leaving, setLeaving] = useState<null | "auto" | "dismiss">(null);
  const exitTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    },
    [],
  );

  const beginExit = useCallback(
    (reason: "auto" | "dismiss") => {
      if (exitTimerRef.current !== null) return; // already leaving
      setLeaving(reason);
      const wait = reduced ? 0 : EXIT_MS;
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        if (reason === "dismiss") onDismiss();
        else onAutoVanish();
      }, wait);
    },
    [reduced, onDismiss, onAutoVanish],
  );

  // 5s auto-vanish; hover/focus pauses (re-arms in full on leave).
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    if (hovering || leaving) return;
    const t = window.setTimeout(() => beginExit("auto"), AUTO_VANISH_MS);
    return () => window.clearTimeout(t);
  }, [hovering, leaving, beginExit]);

  const isParty = session.type === "party_room";
  const accent = isParty ? "168,85,247" : "74,144,217"; // purple vs electric

  const visible = entered && leaving === null;
  const transform = visible ? "translate3d(0, 0, 0)" : "translate3d(24px, 0, 0)";
  const opacity = visible ? 1 : 0;
  const transition = reduced
    ? "none"
    : leaving === null
    ? "transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 300ms ease-out"
    : `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`;

  return (
    <div
      className="pointer-events-none fixed top-40 right-4 left-4 sm:left-auto z-[65] flex justify-end"
      aria-live="polite"
    >
      <div
        role="status"
        className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-2xl shadow-2xl"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        style={{
          background:
            "linear-gradient(135deg, rgba(16,12,26,0.92) 0%, rgba(8,6,16,0.92) 100%)",
          border: `1px solid rgba(${accent},0.45)`,
          boxShadow: `0 12px 36px rgba(0,0,0,0.55), 0 0 24px rgba(${accent},0.15)`,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          transform,
          opacity,
          transition,
          willChange: reduced ? undefined : "transform, opacity",
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex h-2.5 w-2.5 rounded-full"
            style={{
              background: `rgb(${accent})`,
              boxShadow: `0 0 10px rgba(${accent},0.8)`,
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="font-syne text-sm font-bold leading-snug text-cream">
              {headlineFor(session)}
            </p>
            {isParty && (
              <p className="font-mono text-[11px] uppercase tracking-widest text-cream/50">
                Room {session.id}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onRejoin}
            className="shrink-0 rounded-lg px-3.5 py-1.5 font-bebas text-sm tracking-wider transition-all active:scale-95 motion-reduce:transition-none"
            style={{
              background:
                "linear-gradient(135deg, #FFD700 0%, #B8960C 50%, #FFD700 100%)",
              color: "#04080F",
              boxShadow: "0 4px 15px rgba(255,215,0,0.3)",
            }}
          >
            {actionLabelFor(session).toUpperCase()}
          </button>
          <button
            type="button"
            onClick={() => beginExit("dismiss")}
            aria-label="Dismiss for this browser session"
            className="shrink-0 rounded-lg px-2.5 py-1.5 font-syne text-xs text-cream/45 transition-colors hover:text-cream/85 motion-reduce:transition-none"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
