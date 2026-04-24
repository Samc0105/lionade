"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * Silent, non-blocking "if you're already signed in, send you to the
 * dashboard" check. Renders NOTHING — it never gates the parent page.
 *
 * Used on the landing page (app/page.tsx) so first-paint can happen
 * instantly without waiting on any auth state. If the visitor has a
 * Supabase session cached in localStorage, this fires after hydration
 * and navigates them to /dashboard. If they don't, nothing visible
 * happens.
 *
 * The session lookup is race-capped at 1.5s and ignores errors so it
 * can never block or noisily fail.
 */
export default function RedirectIfSignedIn({ to = "/dashboard" }: { to?: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      cancelled = true; // give up silently
    }, 1500);

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data?.session?.user) {
          router.replace(to);
        }
      } catch {
        // ignore — this is best-effort only
      } finally {
        clearTimeout(timeoutId);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [router, to]);

  return null;
}
