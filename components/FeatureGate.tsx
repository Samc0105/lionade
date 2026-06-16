"use client";

// Wraps a feature surface so it can be toggled into maintenance from the admin
// feature-flag panel. Resolves the full dot-path chain for `feature`, so a
// parent (e.g. "games.party") in maintenance also gates every child.
//
// Staff (support / admin) keep seeing the real children with a small fixed
// "staff view" ribbon, so they can verify the surface while it's dark for
// everyone else. Non-staff get the brand MaintenanceState.
//
// FAIL-OPEN: if flags can't be read, useFeatureStatus reports `down=false`
// and children render normally.

import { useFeatureStatus } from "@/lib/use-feature-flags";
import { useAdminRole } from "@/lib/use-admin-role";
import MaintenanceState from "@/components/MaintenanceState";

interface FeatureGateProps {
  /** catalog key, e.g. "games.party.sketch" */
  feature: string;
  /** inline card (sub-feature wrap) vs full-screen maintenance for a page */
  compact?: boolean;
  children: React.ReactNode;
}

export default function FeatureGate({ feature, compact, children }: FeatureGateProps) {
  const { down, flag } = useFeatureStatus(feature);
  const { isStaff } = useAdminRole();

  if (!down) return <>{children}</>;

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
