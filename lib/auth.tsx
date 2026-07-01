"use client";

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { supabase, readStoredSessionSync } from "@/lib/supabase";
import { sanitizeEmail, sanitizePassword, sanitizeUsername, sanitizeText } from "@/lib/sanitize";
import type { Session } from "@supabase/supabase-js";
import { getLevelFromXp } from "@/lib/levels";
import { claimStoredReferral } from "@/lib/referral-client";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatar: string;
  coins: number;
  streak: number;
  xp: number;
  level: number;
  /** true once stats have been loaded from DB (not just defaults) */
  statsLoaded: boolean;
}

export interface SignupExtra {
  firstName?: string;
  dateOfBirth?: string;
  educationLevel?: string;
  studyGoal?: string;
  referralSource?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  signup: (email: string, username: string, password: string, extra?: SignupExtra) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildAuthUser(profile: {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  coins?: number;
  streak?: number;
  xp?: number;
}, email: string): AuthUser {
  const xp = profile.xp ?? 0;
  const level = getLevelFromXp(xp);
  return {
    id: profile.id,
    email,
    username: profile.username,
    displayName: profile.display_name ?? profile.username,
    avatar: profile.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.username}&backgroundColor=4A90D9`,
    coins: profile.coins ?? 0,
    streak: profile.streak ?? 0,
    xp,
    level,
    statsLoaded: true,
  };
}

// Build a minimal user from auth session alone — no DB required
function buildBasicUser(userId: string, email: string, metadata: Record<string, unknown>): AuthUser {
  const username = (metadata?.username as string | undefined)
    ?? email.split("@")[0].replace(/[^a-z0-9_]/g, "_").toLowerCase().slice(0, 20);
  return {
    id: userId,
    email,
    username,
    displayName: (metadata?.display_name as string | undefined) ?? username,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}&backgroundColor=4A90D9`,
    coins: 0,
    streak: 0,
    xp: 0,
    level: 1,
    statsLoaded: false,
  };
}

// Upsert profile in DB — races against 5s timeout so it never blocks login
async function syncProfile(userId: string, email: string, metadata: Record<string, unknown>): Promise<AuthUser | null> {
  const username = (metadata?.username as string | undefined)
    ?? email.split("@")[0].replace(/[^a-z0-9_]/g, "_").toLowerCase().slice(0, 20);

  console.log("[Auth] syncProfile: upserting for", userId, username);

  // Check if profile exists first — only set onboarding_completed on INSERT
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  // Clear any soft-deactivation on login: reaching syncProfile means the
  // user just authenticated successfully, which reactivates the account
  // (see POST /api/user/account/deactivate). Visibility is intentionally NOT
  // restored here — the user chose private on the way out. We do NOT touch
  // pending_deletion_at: a scheduled hard delete is cancelled explicitly via
  // /api/user/account/cancel-deletion, never silently by logging in.
  const upsertData: Record<string, unknown> = {
    id: userId,
    username,
    display_name: username,
    deactivated_at: null,
  };
  if (!existing) {
    upsertData.onboarding_completed = false;
  }

  const upsertPromise = supabase
    .from("profiles")
    .upsert(upsertData, { onConflict: "id", ignoreDuplicates: false })
    .select("id, username, display_name, avatar_url, coins, streak, xp")
    .single();

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => {
      console.warn("[Auth] syncProfile: timed out after 5s");
      resolve(null);
    }, 5000)
  );

  try {
    const result = await Promise.race([upsertPromise, timeoutPromise]);
    if (result?.data) {
      console.log("[Auth] syncProfile: got DB profile", result.data.username, "coins:", result.data.coins, "xp:", result.data.xp, "streak:", result.data.streak);
      return buildAuthUser(result.data, email);
    }
    if (result?.error) {
      console.warn("[Auth] syncProfile: upsert error", result.error.message);
    }
  } catch (err) {
    console.warn("[Auth] syncProfile: exception", err);
  }

  return null;
}

const INACTIVITY_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours
const LAST_ACTIVE_KEY = "lionade_last_active";

function updateLastActive() {
  if (typeof window !== "undefined") {
    localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
  }
}

function isSessionExpiredByInactivity(): boolean {
  if (typeof window === "undefined") return false;
  const last = localStorage.getItem(LAST_ACTIVE_KEY);
  if (!last) return false;
  return Date.now() - parseInt(last, 10) > INACTIVITY_LIMIT_MS;
}

// Settings overhaul 2026-06-11 — Data & Usage > Session history.
// Fire-and-forget after a successful sign-in so the user can see their recent
// logins in Settings. NEVER blocks or delays login: it swallows every error
// and is invoked without `await`. The server route dedupes a burst (skips if
// the caller's most recent event is < 60s old), so calling this from both the
// password-login path AND the OAuth SIGNED_IN listener writes at most one row.
function recordLoginEvent(accessToken: string | null | undefined): void {
  if (!accessToken || typeof window === "undefined") return;
  void fetch("/api/user/login-event", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Synchronous bootstrap: if localStorage already has a valid session
  // (common path: user just came from /login via window.location.assign,
  // or refreshed a page mid-session), initialize state from that BEFORE
  // the component renders. This eliminates the "flash unauth, bounce to
  // /login, bounce back" loop that happens when ProtectedRoute reads
  // user=null before Supabase's async listeners fire.
  const seed = typeof window !== "undefined" ? readStoredSessionSync() : null;

  const [user, setUser] = useState<AuthUser | null>(() => {
    if (!seed) return null;
    return buildBasicUser(
      seed.user.id,
      seed.user.email ?? "",
      (seed.user.user_metadata ?? {}) as Record<string, string>,
    );
  });
  const [session, setSession] = useState<Session | null>(() => (seed as unknown as Session) ?? null);
  const [isLoading, setIsLoading] = useState(() => !seed); // no loading state if we seeded
  // Tracks which user id we have fully loaded from the DB. TOKEN_REFRESHED
  // fires on every tab focus — without this guard we'd reset the user to the
  // basic/default avatar every time, causing a flash until syncProfile returns.
  const loadedUserIdRef = useRef<string | null>(null);

  const refreshUser = async () => {
    const { data: { session: sess } } = await supabase.auth.getSession();
    if (!sess?.user) return;
    const email = sess.user.email ?? "";

    // Just SELECT the profile — don't upsert on refresh
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, coins, streak, xp")
      .eq("id", sess.user.id)
      .single();

    if (error) {
      console.error("[Auth] refreshUser: select error:", error.message);
      return;
    }
    if (profile) {
      console.log("[Auth] refreshUser: coins:", profile.coins, "xp:", profile.xp, "streak:", profile.streak);
      setUser(buildAuthUser(profile, email));
    }
  };

  useEffect(() => {
    console.log("[Auth] Setting up onAuthStateChange listener");

    // If we synchronously seeded `user` from localStorage at mount time,
    // mark the user id as "loaded" so the first onAuthStateChange event
    // (INITIAL_SESSION fired after subscribe) doesn't clobber our seed
    // in the odd case where Supabase decides the session is pending or
    // needs a refresh. This keeps the seeded user on screen continuously
    // — no bounce to /login.
    if (seed?.user?.id) {
      loadedUserIdRef.current = seed.user.id;
      // Kick off a background profile sync so coins/xp/streak/avatar
      // hydrate beyond the basic-from-metadata fields we seeded with.
      void syncProfile(seed.user.id, seed.user.email ?? "", (seed.user.user_metadata ?? {}) as Record<string, string>)
        .then((profile) => { if (profile) setUser(profile); })
        .catch(() => {});
    }

    // Safety net: if onAuthStateChange never fires (Supabase unreachable or
    // the JS client is hung refreshing a stale JWT), fall back to
    // getSession() so the app doesn't stay stuck loading. The previous
    // tuning (3s safety + 2s race = 5s worst case) left first-time visitors
    // staring at a spinner too long; this one caps at 1.5s + 1.5s = 3s.
    let resolved = false;
    const safetyTimer = setTimeout(async () => {
      if (resolved) return;
      console.warn("[Auth] onAuthStateChange did not fire within 1.5s — falling back to getSession()");
      try {
        const getSessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<{ data: { session: null } }>((resolve) =>
          setTimeout(() => {
            console.warn("[Auth] getSession() timed out after 1.5s — assuming no session");
            resolve({ data: { session: null } });
          }, 1500),
        );
        const { data: { session: sess } } = await Promise.race([getSessionPromise, timeoutPromise]);
        if (resolved) return; // listener fired while we were awaiting
        if (sess?.user) {
          const basicUser = buildBasicUser(sess.user.id, sess.user.email ?? "", sess.user.user_metadata ?? {});
          setUser(basicUser);
          setSession(sess);
        } else {
          setUser(null);
          setSession(null);
        }
      } catch (err) {
        console.error("[Auth] getSession fallback failed:", err);
        setUser(null);
        setSession(null);
      } finally {
        // Guarantee the app unblocks even if every code path above threw.
        setIsLoading(false);
      }
    }, 1500);

    // Hard ceiling — if nothing else has cleared isLoading by 3s from mount,
    // force it clear. This is paranoid belt-and-suspenders: no network or
    // code path should EVER keep a first-time visitor on a spinner beyond
    // 3 seconds. If `user` is still null at this point, the landing page
    // (or ProtectedRoute) will treat them as signed-out and render that
    // path's normal unauthenticated UI.
    const maxBootTimer = setTimeout(() => {
      setIsLoading(prev => {
        if (prev) console.warn("[Auth] Hard 3s ceiling hit — forcing isLoading=false");
        return false;
      });
    }, 3000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: any, sess: any) => {
        resolved = true;
        clearTimeout(safetyTimer);
        console.log("[Auth] onAuthStateChange event:", event, "user:", sess?.user?.id ?? "none");

        setSession(sess);

        if (!sess?.user) {
          console.log("[Auth] No session — showing login");
          setUser(null);
          loadedUserIdRef.current = null;
          setIsLoading(false);
          return;
        }

        // Check 2-hour inactivity — sign out if exceeded.
        //
        // Skip on SIGNED_IN: the user is authenticating right now, so they're
        // active by definition. A stale LAST_ACTIVE_KEY from a prior abandoned
        // session must not retroactively force a signout of the fresh login —
        // that bug manifests as "first login click bounces /dashboard back to
        // /login, second click works."
        //
        // Also clear the key on signout so subsequent logins can't re-trigger
        // this on already-stale state (the previous code path was self-perpetuating
        // because supabase.auth.signOut doesn't touch our app-level key).
        if (event !== "SIGNED_IN" && isSessionExpiredByInactivity()) {
          console.log("[Auth] Session expired due to 2-hour inactivity — signing out");
          if (typeof window !== "undefined") {
            localStorage.removeItem(LAST_ACTIVE_KEY);
          }
          await supabase.auth.signOut();
          setUser(null);
          setSession(null);
          loadedUserIdRef.current = null;
          setIsLoading(false);
          return;
        }

        updateLastActive();

        // Settings overhaul 2026-06-11: record the sign-in for Session history.
        // SIGNED_IN-only so token refreshes / focus events don't log. Covers the
        // OAuth return path (Google/Apple) where login() never runs; the server
        // 60s dedupe collapses any overlap with the password-login path.
        if (event === "SIGNED_IN" && sess?.access_token) {
          recordLoginEvent(sess.access_token);
          // Referral growth loop: if this browser arrived with ?ref=CODE
          // (stashed by captureRefFromUrl on the entry surface), attach it now
          // that we have an authenticated session. Fire-and-forget + one-shot
          // (the helper clears the stash immediately); the server validates
          // self-referral / one-per-user / freshness. Covers password signup,
          // OAuth, and the email-verification return path uniformly.
          claimStoredReferral(sess.access_token);
        }

        // If we already have the full profile for this user (e.g. this is a
        // TOKEN_REFRESHED event fired on tab focus), don't reset `user` to the
        // basic default — that's what causes the avatar flash. Just make sure
        // isLoading is cleared and leave the existing user state intact.
        const alreadyLoadedForThisUser =
          loadedUserIdRef.current === sess.user.id;

        if (alreadyLoadedForThisUser) {
          console.log("[Auth] Token refresh for already-loaded user — keeping existing state");
          setIsLoading(false);
          return;
        }

        // First time seeing this user (or different user). Set a basic user
        // IMMEDIATELY from session metadata — no DB call. This unblocks the
        // login redirect right away.
        const basicUser = buildBasicUser(
          sess.user.id,
          sess.user.email ?? "",
          sess.user.user_metadata ?? {}
        );
        console.log("[Auth] Setting basic user immediately:", basicUser.username);
        setUser(basicUser);
        setIsLoading(false);

        // Sync full profile with DB in background (non-blocking)
        syncProfile(sess.user.id, sess.user.email ?? "", sess.user.user_metadata ?? {})
          .then((profile) => {
            if (profile) {
              console.log("[Auth] Updated user from DB profile — coins:", profile.coins, "xp:", profile.xp, "streak:", profile.streak);
              setUser(profile);
              loadedUserIdRef.current = sess.user.id;
            } else {
              console.warn("[Auth] syncProfile returned null — marking statsLoaded anyway");
              setUser(prev => prev ? { ...prev, statsLoaded: true } : prev);
              loadedUserIdRef.current = sess.user.id;
            }
          });
      }
    );

    return () => {
      clearTimeout(safetyTimer);
      clearTimeout(maxBootTimer);
      console.log("[Auth] Cleaning up subscription");
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string): Promise<{ error?: string }> => {
    const cleanEmail = sanitizeEmail(email);
    const cleanPassword = sanitizePassword(password);

    // Mark the user as active *before* signInWithPassword so the SIGNED_IN
    // listener never sees a stale LAST_ACTIVE_KEY and force-signs them out
    // mid-login. Belt-and-suspenders: the listener also skips the inactivity
    // check on SIGNED_IN events, but updating here closes any handler-ordering
    // gap and means a partial sign-in still leaves consistent state.
    updateLastActive();

    // Check brute-force lock before attempting sign-in.
    // 3s AbortController timeout — if the check endpoint hangs, fail open so
    // the login button can never stall indefinitely on a network wobble.
    try {
      const controller = new AbortController();
      const abortId = setTimeout(() => controller.abort(), 3000);
      const lockRes = await fetch(`/api/auth/check-lock?email=${encodeURIComponent(cleanEmail)}`, {
        signal: controller.signal,
      });
      clearTimeout(abortId);
      const lockData = await lockRes.json();
      if (lockData.locked) {
        return { error: "Account temporarily locked due to too many failed attempts. Try again in 15 minutes." };
      }
    } catch {
      // Fail open — allow login if the check endpoint is unreachable or slow
    }

    console.log("[Auth] login() called for", cleanEmail);

    // 10s timeout around signInWithPassword so the button can never spin forever
    const signInPromise = supabase.auth.signInWithPassword({ email: cleanEmail, password: cleanPassword });
    const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) =>
      setTimeout(
        () => resolve({ data: null, error: { message: "Network timeout — check your connection and try again." } }),
        10000,
      ),
    );
    const { data, error } = await Promise.race([signInPromise, timeoutPromise]);
    console.log("[Auth] signInWithPassword result — error:", error?.message ?? "none", "user:", data?.user?.id ?? "none");

    // Record FAILED attempts only (fire-and-forget, don't block login flow).
    // The public record-attempt endpoint rejects success:true to stop attackers
    // from clearing a victim's failed-attempt counter; successful logins clear
    // their own counter via the authed /api/auth/clear-attempts route below.
    if (error) {
      fetch("/api/auth/record-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, success: false }),
      }).catch(() => null);
    } else if (data?.session?.access_token) {
      fetch("/api/auth/clear-attempts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
      }).catch(() => null);
      // Log the successful sign-in for the Settings > Session history list.
      recordLoginEvent(data.session.access_token);
    }

    if (error) return { error: error.message };

    // Proactively propagate the session into our React state. Don't wait
    // for onAuthStateChange to fire — under certain network/client-timing
    // conditions it lags or misses the SIGNED_IN event on first sign-in,
    // which was the root cause of "login spins forever on first attempt."
    // signInWithPassword returns the session object directly; we use it.
    if (data?.user && data?.session) {
      const basicUser = buildBasicUser(
        data.user.id,
        data.user.email ?? "",
        data.user.user_metadata ?? {},
      );
      setSession(data.session);
      setUser(basicUser);
      setIsLoading(false);

      // Background-hydrate the full profile (coins, streak, avatar, …) so
      // the dashboard lands with real numbers. Non-blocking — the caller
      // can navigate immediately on our return.
      syncProfile(data.user.id, data.user.email ?? "", data.user.user_metadata ?? {})
        .then((profile) => {
          if (profile) {
            setUser(profile);
            loadedUserIdRef.current = data.user.id;
          } else {
            setUser(prev => prev ? { ...prev, statsLoaded: true } : prev);
            loadedUserIdRef.current = data.user.id;
          }
        })
        .catch(() => {
          loadedUserIdRef.current = data.user.id;
        });
    }

    updateLastActive();
    return {};
  };

  const signup = async (
    email: string,
    username: string,
    password: string,
    extra?: SignupExtra
  ): Promise<{ error?: string }> => {
    // Sanitize all inputs before processing
    email    = sanitizeEmail(email);
    username = sanitizeUsername(username);
    password = sanitizePassword(password);
    if (extra?.firstName) extra.firstName = sanitizeText(extra.firstName, 50);

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username.trim())
      .maybeSingle();

    if (existing) return { error: "Username already taken. Try another." };

    // Route the confirmation email back to the current origin — works on
    // localhost, previews, and whatever domain we deploy to without
    // hardcoding a subdomain.
    const emailRedirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/login`
        : undefined;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
        data: {
          username: username.trim(),
          display_name: extra?.firstName ?? username.trim(),
          first_name: extra?.firstName ?? "",
          date_of_birth: extra?.dateOfBirth ?? null,
          education_level: extra?.educationLevel ?? "",
          study_goal: extra?.studyGoal ?? "",
          referral_source: extra?.referralSource ?? "",
        },
      },
    });

    if (error) return { error: error.message };

    // Eagerly write profile row — only use columns that exist in the table
    if (data.user) {
      supabase.from("profiles").upsert({
        id: data.user.id,
        username: username.trim(),
        display_name: extra?.firstName ?? username.trim(),
        study_goal: extra?.studyGoal ?? null,
        onboarding_completed: false,
      }, { onConflict: "id" }).then(({ error: e }: any) => {
        if (e) console.warn("[Auth] signup profile upsert:", e.message);
      });
    }

    return {};
  };

  const logout = async () => {
    console.log("[Auth] logout()");
    if (typeof window !== "undefined") {
      localStorage.removeItem(LAST_ACTIVE_KEY);
    }
    // Drop cached onboarding pass so a re-login on the same tab
    // re-validates the next user (different account = different check).
    const { clearOnboardingCache } = await import("@/components/ProtectedRoute");
    clearOnboardingCache();
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    loadedUserIdRef.current = null;
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
