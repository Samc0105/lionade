"use client";

// Client-side view of the caller's app role, via GET /api/admin/me.
//
// Used by the Navbar (show/hide the Admin tab) and app/admin/layout.tsx
// (redirect non-staff away). SWR dedupes so they share one request.
// UX-gating only — the server re-checks the role on every /api/admin call.

import useSWR from "swr";
import { useAuth } from "@/lib/auth";
import { swrFetcher } from "@/lib/api-client";
import type { AppRole } from "@/lib/admin-auth";

export interface AdminRoleState {
  role: AppRole;
  /** support or admin */
  isStaff: boolean;
  isAdmin: boolean;
  /** true while signed in but the role hasn't resolved yet */
  loading: boolean;
}

export function useAdminRole(): AdminRoleState {
  const { user } = useAuth();
  const { data, isLoading } = useSWR<{ role?: string }>(
    user ? "/api/admin/me" : null,
    swrFetcher,
    {
      dedupingInterval: 5 * 60 * 1000,
      revalidateOnFocus: false,
      // A failed role fetch must read as 'user' (hide everything), never retry-spam
      shouldRetryOnError: false,
    },
  );

  const role: AppRole =
    data?.role === "admin" || data?.role === "support" ? data.role : "user";

  return {
    role,
    isStaff: role === "admin" || role === "support",
    isAdmin: role === "admin",
    loading: Boolean(user) && isLoading,
  };
}
