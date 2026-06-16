"use client";

// Whole-site kill-switch. Reads the "site" feature flag (windows already
// pre-resolved by the public endpoint) and resolves it to one of three states:
//
//   - maintenance + non-staff -> replace the entire page body with the brand
//     MaintenanceState. Staff ALWAYS bypass so an admin can still reach /admin
//     and lift the flag.
//   - warning -> render the normal page PLUS a slim top warning bar for
//     everyone (staff included). The site stays fully usable; nothing is
//     blocked.
//   - live -> children only.
//
// Recovery surfaces (/admin, /login, etc.) are safe because nothing wraps them
// at the page level beyond this body gate, and staff bypass guarantees admin
// access; the catalog has no nodes for them.
//
// THE PUBLIC /status PAGE IS A RECOVERY SURFACE. It must stay reachable even
// when the 'site' flag is in maintenance, so a visitor can always see what is
// going on. We exempt /status and /status/* here: on those paths we render
// children unconditionally, before any maintenance/warning decision, so neither
// the maintenance takeover nor the warning bar ever wraps it. All other paths
// keep the full behavior (staff bypass, loading hold, warning bar).
//
// FAIL-OPEN: if flags can't be read, useFeatureStatus('site') reports
// down=false and warn=false, so children render normally.

import { Warning } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useFeatureStatus } from "@/lib/use-feature-flags";
import { useAdminRole } from "@/lib/use-admin-role";
import MaintenanceState from "@/components/MaintenanceState";

export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { down, warn, flag } = useFeatureStatus("site");
  const { isStaff, loading } = useAdminRole();

  // RECOVERY-SURFACE EXEMPTION: the public status page must ALWAYS be reachable,
  // even under a 'site' maintenance flag. Render it untouched on /status and any
  // /status/* subpath, before any gate decision. Match exactly /status or a
  // /status/ prefix so an unrelated path like /statusboard is NOT exempted.
  if (pathname === "/status" || pathname?.startsWith("/status/")) {
    return <>{children}</>;
  }

  // While the role is still resolving, hold children rather than showing the
  // maintenance screen: a staff member hard-refreshing during a site
  // maintenance flag would otherwise briefly see "down" before isStaff lands.
  // This keeps admins out of the maintenance view and matches the fail-open
  // stance used everywhere else in the flag system.
  if (down && !isStaff && !loading) {
    return <MaintenanceState flag={flag} />;
  }

  // Site warning: keep the whole app usable, add a slim informational bar at
  // the very top for everyone. Maintenance beats warning, so when down is true
  // (staff bypass case) we never also show the warning bar.
  if (warn && !down) {
    const message =
      flag?.message?.trim() ||
      "Some features may be flaky right now while we work on a fix.";
    return (
      <>
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-gold/25 bg-gold/10 px-4 py-2 text-center"
        >
          <Warning weight="duotone" size={16} className="shrink-0 text-gold" aria-hidden="true" />
          <span className="text-xs text-cream/85 sm:text-sm">{message}</span>
        </div>
        {children}
      </>
    );
  }

  return <>{children}</>;
}
