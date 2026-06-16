"use client";

// Wraps a feature surface so it can be toggled from the admin feature-flag
// panel. Resolves the full dot-path chain for `feature`, so a parent
// (e.g. "games.party") also gates every child.
//
// Three states (the public endpoint pre-resolves scheduling windows, so the
// client only reads the effective status):
//   - maintenance in chain -> non-staff get the brand MaintenanceState; staff
//     keep the real children with a small fixed "staff view" ribbon so they can
//     verify the surface while it's dark for everyone else.
//   - warning in chain (and NOT maintenance) -> everyone keeps the real
//     children, with a dismissible "known issue" banner above them. The API is
//     not blocked in this state.
//   - live -> children only.
//
// FAIL-OPEN: if flags can't be read, useFeatureStatus reports down=false and
// warn=false, so children render normally.

import { useFeatureStatus } from "@/lib/use-feature-flags";
import { useAdminRole } from "@/lib/use-admin-role";
import MaintenanceState from "@/components/MaintenanceState";
import FeatureWarningBanner from "@/components/FeatureWarningBanner";

interface FeatureGateProps {
  /** catalog key, e.g. "games.party.sketch" */
  feature: string;
  /** inline card (sub-feature wrap) vs full-screen maintenance for a page */
  compact?: boolean;
  children: React.ReactNode;
}

export default function FeatureGate({ feature, compact, children }: FeatureGateProps) {
  const { down, warn, warnKey, flag } = useFeatureStatus(feature);
  const { isStaff } = useAdminRole();

  // Maintenance always wins over warning. When down, useFeatureStatus
  // guarantees warn=false, so the two branches never collide.
  if (down) {
    if (isStaff) {
      return (
        <>
          <div
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[80] px-3 py-1.5 rounded-full border border-gold/40 bg-navy/90 backdrop-blur shadow-lg font-mono text-[10px] uppercase tracking-[0.2em] text-gold pointer-events-none"
            role="status"
          >
            In maintenance (staff view)
          </div>
          {children}
        </>
      );
    }
    return <MaintenanceState flag={flag} compact={compact} />;
  }

  // Warning: feature stays usable for everyone (staff included). Show a
  // dismissible known-issue banner above the real children.
  if (warn) {
    return (
      <>
        <FeatureWarningBanner flag={flag} featureKey={warnKey ?? feature} />
        {children}
      </>
    );
  }

  return <>{children}</>;
}
