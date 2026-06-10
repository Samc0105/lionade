"use client";

// Global Lionade Party invite toast.
//
// Mounted once in app/layout.tsx (inside ToastProvider + AuthProviderWrapper)
// so it can surface on ANY page — Dashboard, Social, mid-quiz, anywhere. It
// does NOT open its own Realtime channel: the Navbar's existing
// `notifs-${user.id}` postgres_changes subscription re-emits party_invite
// rows over lib/party/invite-bus.ts and this component just listens.
//
// Behavior:
//   - Max 1 visible at a time; a newer invite replaces the current one.
//   - Auto-dismisses after 30s with a thin draining gold progress bar.
//   - "Join" (gold) routes to /games/party/<code> and marks the underlying
//     notification read; "Dismiss" just closes the banner (the notification
//     stays unread in the bell, so nothing is lost).
//   - Suppressed when the user is already inside that exact room.
//   - Never renders logged-out (the bus only fires from the authed Navbar
//     channel anyway — this is defense in depth).
//   - GPU-only animation (translate3d + opacity), reduced-motion respected.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { apiPatch } from "@/lib/api-client";
import { usePartyInvite, type PartyInviteDetail } from "@/lib/party/invite-bus";

const AUTO_DISMISS_MS = 30_000;
const EXIT_MS = 200;

type ActiveInvite = PartyInviteDetail & {
  /** Unique per arrival so a replacing invite restarts timers + animations. */
  key: number;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function PartyInviteToast() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  const [invite, setInvite] = useState<ActiveInvite | null>(null);
  const [leaving, setLeaving] = useState(false);
  const lastNotifIdRef = useRef<string | null>(null);
  // Handle of the in-flight exit timer (dismiss schedules setInvite(null)
  // EXIT_MS out). Tracked so a new invite arriving inside that window cancels
  // the wipe instead of being cleared 200ms after it lands.
  const exitTimerRef = useRef<number | null>(null);
  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearExitTimer, [clearExitTimer]); // unmount cleanup

  // Inbound invites from the Navbar's notifications channel (via the bus).
  usePartyInvite(
    useCallback((detail: PartyInviteDetail) => {
      // Already standing in that exact room? No banner needed.
      if (pathnameRef.current === `/games/party/${detail.code}`) return;
      // Dedupe: the same notification row should only toast once.
      if (detail.notificationId && detail.notificationId === lastNotifIdRef.current) return;
      lastNotifIdRef.current = detail.notificationId || null;
      // Accepted — a pending exit from a just-dismissed banner must not wipe
      // this replacement 200ms after it lands. (Cleared only AFTER the early
      // returns: a suppressed invite must still let the old exit complete.)
      clearExitTimer();
      // Newest replaces oldest — never stacks.
      setLeaving(false);
      setInvite({ ...detail, key: Date.now() });
    }, [clearExitTimer]),
  );

  const dismiss = useCallback(() => {
    setLeaving(true);
    const exit = prefersReducedMotion() ? 0 : EXIT_MS;
    clearExitTimer();
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      setInvite(null);
      setLeaving(false);
    }, exit);
  }, [clearExitTimer]);

  // 30s auto-dismiss, restarted whenever a fresh invite lands.
  useEffect(() => {
    if (!invite) return;
    const handle = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(handle);
  }, [invite, dismiss]);

  const join = useCallback(() => {
    if (!invite) return;
    // Mark the bell notification read in the background — the user acted on it.
    if (invite.notificationId) {
      void apiPatch("/api/notifications", { id: invite.notificationId, read: true });
    }
    const code = invite.code;
    dismiss();
    router.push(`/games/party/${code}`);
  }, [invite, dismiss, router]);

  if (!user?.id || !invite) return null;

  const reduced = prefersReducedMotion();
  const show = !leaving;

  return (
    <div
      className="pointer-events-none fixed top-20 left-0 right-0 z-[70] flex justify-center px-4"
      aria-live="polite"
    >
      <Banner
        key={invite.key}
        invite={invite}
        show={show}
        reduced={reduced}
        onJoin={join}
        onDismiss={dismiss}
      />
    </div>
  );
}

// Inner banner keyed by invite.key so a replacing invite re-mounts and
// replays the enter animation + progress drain from the top.
function Banner({
  invite,
  show,
  reduced,
  onJoin,
  onDismiss,
}: {
  invite: ActiveInvite;
  show: boolean;
  reduced: boolean;
  onJoin: () => void;
  onDismiss: () => void;
}) {
  // Toast.tsx pattern: paint hidden, flip visible on the next frame so the
  // browser commits the initial transform before transitioning.
  const [entered, setEntered] = useState<boolean>(reduced);
  useEffect(() => {
    if (reduced) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [reduced]);

  // Progress drain: scaleX 1 -> 0 over 30s. Same two-frame trick — pure
  // transform, GPU-composited, no width animation. Hidden for reduced motion
  // (the 30s timer still dismisses).
  const [draining, setDraining] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDraining(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const visible = entered && show;
  const transform = visible ? "translate3d(0, 0, 0)" : "translate3d(0, -16px, 0)";
  const opacity = visible ? 1 : 0;
  const transition = reduced
    ? "none"
    : show
    ? "transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 300ms ease-out"
    : `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`;

  return (
    <div
      role="status"
      className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl shadow-2xl"
      style={{
        background: "linear-gradient(135deg, rgba(16,12,26,0.92) 0%, rgba(8,6,16,0.92) 100%)",
        border: "1px solid rgba(168,85,247,0.45)",
        boxShadow: "0 12px 36px rgba(0,0,0,0.55), 0 0 24px rgba(168,85,247,0.15)",
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
          className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full"
          style={{
            background: "linear-gradient(135deg, rgba(168,85,247,0.25) 0%, rgba(99,102,241,0.15) 100%)",
            border: "1px solid rgba(168,85,247,0.4)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E9D5FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5.8 11.3 2 22l10.7-3.8" />
            <path d="M4 3h.01" />
            <path d="M22 8h.01" />
            <path d="M15 2h.01" />
            <path d="M22 20h.01" />
            <path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" />
            <path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17" />
            <path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7" />
            <path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z" />
          </svg>
        </span>
        <p className="min-w-0 flex-1 font-syne text-sm leading-snug text-cream/90">
          <span className="font-bold text-cream">{invite.senderName}</span>
          {" "}invited you to a party
        </p>
        <button
          type="button"
          onClick={onJoin}
          className="shrink-0 rounded-lg px-3.5 py-1.5 font-bebas text-sm tracking-wider transition-all active:scale-95"
          style={{
            background: "linear-gradient(135deg, #FFD700 0%, #B8960C 50%, #FFD700 100%)",
            color: "#04080F",
            boxShadow: "0 4px 15px rgba(255,215,0,0.3)",
          }}
        >
          JOIN
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg px-2.5 py-1.5 font-syne text-xs text-cream/45 transition-colors hover:text-cream/85"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          Dismiss
        </button>
      </div>
      {/* Thin draining progress bar — transform-only (scaleX), linear 30s. */}
      {!reduced && (
        <div className="h-0.5 w-full" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div
            aria-hidden="true"
            className="h-full"
            style={{
              background: "linear-gradient(90deg, #FFD700 0%, #A855F7 100%)",
              transformOrigin: "left center",
              transform: draining ? "scaleX(0)" : "scaleX(1)",
              transition: draining ? `transform ${AUTO_DISMISS_MS}ms linear` : "none",
              willChange: "transform",
            }}
          />
        </div>
      )}
    </div>
  );
}
