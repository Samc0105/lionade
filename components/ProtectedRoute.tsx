"use client";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";

// Module-level cache — keyed by user id. Once we've confirmed a user is
// onboarded in this tab, every subsequent navigation can skip the
// onboarding fetch entirely. Cleared on logout via clearOnboardingCache().
// This is what makes tab switches feel instant: prior version ran a full
// supabase.auth.getUser() + profile fetch on EVERY navigation.
const onboardedUserIds = new Set<string>();

export function clearOnboardingCache() {
  onboardedUserIds.clear();
}

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const [status, setStatus] = useState<"checking" | "pass" | "redirecting">(
    () => (user?.id && onboardedUserIds.has(user.id) ? "pass" : "checking"),
  );
  const hasChecked = useRef(false);

  // Defer auth-driven rendering to after hydration. useAuth seeds from
  // localStorage on the client, so the SSR pass renders the spinner but
  // the first client render renders authed content — guaranteed mismatch
  // without this gate.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Safety timeout — never stay stuck on loading spinner
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, [isLoading]);

  // Redirect unauthenticated users to login.
  //
  // Bug-fix 2026-06-03: this effect previously fired on the very first
  // commit, before AuthProvider's onAuthStateChange listener (which seeds
  // `user` from localStorage asynchronously) had a chance to populate the
  // user. That made post-login navigation flicker — `window.location.assign`
  // lands on /dashboard, AuthProvider hasn't fully resolved yet, we see
  // `!isLoading && !user` for one frame and bounce to /login, then bounce
  // back to /dashboard once the listener fires. By gating on `mounted` we
  // wait at least one client-side render after hydration, AND we require
  // `!isLoading` (no `|| timedOut` shortcut here) so the seed path is given
  // a real chance to populate before we redirect. The 6s timedOut path is
  // the safety net for genuinely-unauthenticated visitors below.
  useEffect(() => {
    if (!mounted) return;
    if (isLoading && !timedOut) return;
    if (user) return;
    console.log("[ProtectedRoute] No user after hydration — redirecting to /login", { isLoading, timedOut });
    router.replace("/login");
  }, [mounted, user, isLoading, timedOut, router]);

  // Check onboarding — runs once per session, cached at module scope.
  //
  // Skipped entirely when this user is already in `onboardedUserIds`
  // (the common case after the first navigation), which is what
  // eliminates the "loading flash on every tab click" feel.
  //
  // We rely on `user.id` from useAuth (seeded from localStorage in
  // AuthProvider) instead of supabase.auth.getUser() — the latter was
  // a network round-trip on every navigation. If the JWT is actually
  // bad, the profile query below will fail under RLS and we'll fall
  // back to the catch branch.
  useEffect(() => {
    if (!user) return;
    if (hasChecked.current) return;
    if (onboardedUserIds.has(user.id)) {
      hasChecked.current = true;
      setStatus("pass");
      return;
    }

    console.log("[ProtectedRoute] Checking onboarding for user:", user.id);

    (async () => {
      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("onboarding_completed, username")
          .eq("id", user.id)
          .maybeSingle();

        console.log("[ProtectedRoute] Profile query result:", { profile, error: error?.message ?? null });

        // Self-heal: if no profile row exists (trigger missed), create one
        let currentProfile = profile;
        if (!currentProfile && !error) {
          console.log("[ProtectedRoute] No profile row — creating fallback for", user.id);
          const fallbackUsername = (user.email ?? "").split("@")[0].replace(/[^a-z0-9_]/g, "_").toLowerCase().slice(0, 20) || "user";
          await supabase.from("profiles").insert({
            id: user.id,
            username: fallbackUsername,
            display_name: user.displayName ?? fallbackUsername,
            onboarding_completed: false,
          });
          const { data: freshProfile } = await supabase
            .from("profiles")
            .select("onboarding_completed, username")
            .eq("id", user.id)
            .maybeSingle();
          currentProfile = freshProfile;
        }

        hasChecked.current = true;

        // User is onboarded if flag is set OR they already have a username (pre-flag users)
        const isOnboarded = currentProfile?.onboarding_completed || (currentProfile?.username && currentProfile.username.trim().length > 0);

        if (!currentProfile || !isOnboarded) {
          console.log("[ProtectedRoute] onboarding NOT complete — redirecting to /onboarding");
          setStatus("redirecting");
          router.replace("/onboarding");
          return;
        }

        console.log("[ProtectedRoute] onboarding complete — showing page");
        onboardedUserIds.add(user.id);
        setStatus("pass");
      } catch (err) {
        console.error("[ProtectedRoute] Error checking onboarding:", err);
        // On error, let the user through rather than blocking them
        hasChecked.current = true;
        setStatus("pass");
      }
    })();
  }, [user, router]);

  if (!mounted || (isLoading && !timedOut)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" />
          <p className="font-bebas text-2xl text-electric tracking-widest">LOADING...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" />
          <p className="font-bebas text-2xl text-electric tracking-widest">LOADING...</p>
        </div>
      </div>
    );
  }

  if (status !== "pass") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" />
          <p className="font-bebas text-2xl text-electric tracking-widest">LOADING...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
