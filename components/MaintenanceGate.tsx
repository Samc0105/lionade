"use client";

// Whole-site kill-switch. Reads the "site" feature flag and, when it's in
// maintenance, replaces the entire page body with the brand MaintenanceState
// for non-staff visitors.
//
// Staff (support / admin) ALWAYS bypass this gate so an admin can still reach
// /admin and lift the flag. Recovery surfaces (/admin, /login, etc.) are also
// safe because nothing wraps them at the page level beyond this body gate, and
// staff bypass guarantees admin access; the catalog has no nodes for them.
//
// FAIL-OPEN: if flags can't be read, useFeatureStatus('site') reports
// `down=false` and children render normally.

import { useFeatureStatus } from "@/lib/use-feature-flags";
import { useAdminRole } from "@/lib/use-admin-role";
import MaintenanceState from "@/components/MaintenanceState";

export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { down, flag } = useFeatureStatus("site");
  const { isStaff, loading } = useAdminRole();

  // While the role is still resolving, hold children rather than showing the
  // maintenance screen: a staff member hard-refreshing during a site
  // maintenance flag would otherwise briefly see "down" before isStaff lands.
  // This keeps admins out of the maintenance view and matches the fail-open
  // stance used everywhere else in the flag system.
  if (down && !isStaff && !loading) {
    return <MaintenanceState flag={flag} />;
  }

  return <>{children}</>;
}
