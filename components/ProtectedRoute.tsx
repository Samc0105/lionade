"use client";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const [status, setStatus] = useState<"checking" | "pass" | "redirecting">("checking");
  const hasChecked = useRef(false);

  // Safety timeout — never stay stuck on loading spinner
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, [isLoading]);

  // Redirect unauthenticated users to login
  useEffect(() => {
    if ((!isLoading || timedOut) && !user) {
      router.replace("/login");
    }
  }, [user, isLoading, timedOut, router]);

  // Check onboarding — runs once when user is available
  useEffect(() => {
    if (!user) return;
    if (hasChecked.current) return; // only run once

    console.log("[ProtectedRoute] Checking onboarding for user:", user.id);

    (async () => {
      try {
        // Use getUser() to ensure we have a valid session
        const { data: { user: authUser } } = await supabase.auth.getUser();
        console.log("[ProtectedRoute] auth.getUser():", authUser?.id ?? "NO AUTH USER");

        if (!authUser) {
          console.log("[ProtectedRoute] No auth user — redirecting to login");
          router.replace("/login");
          return;
        }

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", authUser.id)
          .maybeSingle();

        console.log("[ProtectedRoute] Profile query result:", { profile, error: error?.message ?? null });

        // Self-heal: if no profile row exists (trigger missed), create one
        if (!profile && !error) {
          console.log("[ProtectedRoute] No profile row — creating fallback for", authUser.id);
          const username = (authUser.email ?? "").split("@")[0].replace(/[^a-z0-9_]/g, "_").toLowerCase().slice(0, 20) || "user";
          await supabase.from("profiles").insert({
            id: authUser.id,
            username,
            display_name: authUser.user_metadata?.display_name ?? username,
            onboarding_completed: false,
          });
        }

        hasChecked.current = true;

        if (!profile || !profile.onboarding_completed) {
          console.log("[ProtectedRoute] onboarding NOT complete — redirecting to /onboarding");
          setStatus("redirecting");
          router.replace("/onboarding");
          return;
        }

        console.log("[ProtectedRoute] onboarding complete — showing page");
        setStatus("pass");
      } catch (err) {
        console.error("[ProtectedRoute] Error checking onboarding:", err);
        // On error, redirect to onboarding to be safe
        hasChecked.current = true;
        setStatus("redirecting");
        router.replace("/onboarding");
      }
    })();
  }, [user, router]);

  if (isLoading && !timedOut) {
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
