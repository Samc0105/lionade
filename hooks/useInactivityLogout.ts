"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const INACTIVITY_TIMEOUT_MS = 7_200_000; // 2 hours

/** Routes where the timer is paused (active quiz/duel in progress) */
const PAUSED_ROUTES = ["/quiz", "/duel"];

export function useInactivityLogout() {
  const { user } = useAuth();
  const pathname = usePathname();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;

    // Pause timer on active quiz/duel routes
    const isPaused = PAUSED_ROUTES.some((r) => pathname.startsWith(r));
    if (isPaused) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const logout = async () => {
      await supabase.auth.signOut();
      window.location.href = "/login";
    };

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(logout, INACTIVITY_TIMEOUT_MS);
    };

    // Start the timer
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
