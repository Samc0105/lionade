"use client";

/**
 * TeamGate — the forced-onboarding redirect gate for staff accounts.
 *
 * Mounted once globally (in app/layout.tsx, inside the auth provider and near
 * SessionLifecycle). It enforces two server-armed flags carried on the auth
 * session's user_metadata:
 *
 *   1. must_change_password === true  -> route to /onboard/password
 *   2. mfa_required === true (set by provision for the enforced-MFA role set)
 *      AND no verified TOTP factor -> route to /onboard/mfa
 *
 * DESIGN: ZERO-NETWORK for normal users.
 *   - must_change_password is read straight off user_metadata. No fetch.
 *   - mfa_required is also read off user_metadata. A normal (non-staff) user
 *     has no mfa_required flag, so we NEVER call listFactors() for them.
 *   - Only an account explicitly flagged mfa_required calls
 *     supabase.auth.mfa.listFactors() — and only once per session, cached in a
 *     module-level Set keyed by userId, so navigations don't re-hit it.
 *
 * NO REDIRECT LOOPS:
 *   - Exempt paths (/onboard/*, /reset-password, /login, /signup, /logout) are
 *     never redirected, so the destinations we send people to are themselves
 *     exempt. The onboarding pages clear the flags (password) / verify the
 *     factor (mfa) and then navigate onward themselves.
 *   - We only act when a user is present; logged-out visitors are untouched.
 *
 * This component renders nothing.
 */

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

// Paths the gate never redirects away from. The onboarding destinations live
// under /onboard so they are self-exempt (no loop). Auth flows are exempt too.
const EXEMPT_PREFIXES = [
  "/onboard",
  "/reset-password",
  "/login",
  "/signup",
  "/logout",
];

function isExempt(pathname: string): boolean {
  return EXEMPT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

// Per-session cache of userIds we've already confirmed have a verified TOTP
// factor. Module-scoped so it survives component remounts within a tab but is
// naturally cleared on a full reload (new tab / re-login). Only mfa_required
// accounts ever populate this — normal users never reach the listFactors call.
const mfaConfirmed = new Set<string>();

export default function TeamGate() {
  const { user, session } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";

  useEffect(() => {
    // Only act when a user is present. Logged-out visitors are never gated.
    if (!user || !session?.user) return;

    // Never redirect away from an exempt path (prevents loops: the onboarding
    // pages we route to are themselves exempt).
    if (isExempt(pathname)) return;

    const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
    const userId = session.user.id;

    // 1) Forced password change. Pure metadata read — zero network.
    if (meta.must_change_password === true) {
      router.replace("/onboard/password");
      return;
    }

    // 2) Forced MFA enrollment. Only accounts the server flagged mfa_required
    //    get here, so normal users never trigger a factor read.
    if (meta.mfa_required !== true) return;

    // Already confirmed this session — no repeat network call.
    if (mfaConfirmed.has(userId)) return;

    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (cancelled) return;
        if (error) {
          // Read fault: do NOT hard-redirect (we can't prove they're
          // unenrolled). The cron is the backstop; fail open here.
          return;
        }
        // `totp` is the verified-only TOTP array; `all` includes unverified.
        const verified = (data?.totp ?? []).length > 0;
        if (verified) {
          mfaConfirmed.add(userId);
          return;
        }
        // No verified factor — route to enrollment. /onboard is exempt, so no
        // loop. Re-check current path in case the user navigated meanwhile.
        if (!isExempt(window.location.pathname)) {
          router.replace("/onboard/mfa");
        }
      } catch {
        // Network/throw — fail open, the cron enforcement remains the backstop.
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-run on user/path change. session is read inside; user.id changing is
    // the meaningful identity change and is captured via `user`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, pathname]);

  return null;
}
