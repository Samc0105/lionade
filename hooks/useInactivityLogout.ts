"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const INACTIVITY_TIMEOUT_MS = 7_200_000; // 2 hours
const LAST_ACTIVE_KEY = "lionade_last_active";

/** Routes where the timer is paused (active quiz/duel in progress) */
const PAUSED_ROUTES = ["/quiz", "/duel"];

export function useInactivityLogout() {
  const { user } = useAuth();
  const pathname = usePathname();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: check if 2+ hours have passed since last activity
  useEffect(() => {
    if (!user) return;

    const last = localStorage.getItem(LAST_ACTIVE_KEY);
    if (last) {
      const elapsed = Date.now() - parseInt(last, 10);
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        supabase.auth.signOut().then(() => {
          localStorage.removeItem(LAST_ACTIVE_KEY);
          window.location.href = "/login";
        });
        return;
      }
    } else {
      // No timestamp exists — set it now
      localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    }
  }, [user]);

  // In-session inactivity timer + persist timestamp on interaction
  useEffect(() => {
    if (!user) return;

    const isPaused = PAUSED_ROUTES.some((r) => pathname.startsWith(r));
    if (isPaused) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const logout = async () => {
      localStorage.removeItem(LAST_ACTIVE_KEY);
      await supabase.auth.signOut();
      window.location.href = "/login";
    };

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, INACTIVITY_TIMEOUT_MS);
      // Persist timestamp so cross-session check works
      localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    };

    resetTimer();

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ];

    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [user, pathname]);
}
