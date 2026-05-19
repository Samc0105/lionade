"use client";

import { useState } from "react";
import { Crown } from "@phosphor-icons/react";
import { usePlan } from "@/lib/use-plan";
import { useAuth } from "@/lib/auth";
import ClaimBanner from "@/components/ClaimBanner";

/**
 * Free → Pro upgrade nudge. Shows ONLY for Free-tier users.
 *
 * Plan detection uses the canonical `usePlan()` hook (reads
 * `profiles.plan`, SWR-backed, fail-closed to "free") — no invented
 * state. Hidden for paid users, while plan is still loading (avoids a
 * flash), for signed-out users, and once dismissed this session.
 *
 * Single mount point: dashboard, in the existing nudge band, below the
 * time-critical StreakReviveBanner so it never competes for urgency.
 * CTA links to /pricing.
 *
 * Facts in copy come from lib/mastery-plan.ts: Pro = $6.99/mo, 1.5×
 * Fangs (free is 1.0×), 3 Mastery exams (free 1), no popup ads.
 */
export default function ProUpgradeNudge() {
  const { user } = useAuth();
  const { plan, isLoading } = usePlan();
  const [dismissed, setDismissed] = useState(false);

  if (!user?.id) return null;
  if (isLoading) return null;       // don't flash before plan resolves
  if (plan !== "free") return null; // paid users never see it
  if (dismissed) return null;

  return (
    <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.05s" }}>
      <ClaimBanner
        variant="purple"
        size="panel"
        role="region"
        ariaLabel="Upgrade to Lionade Pro"
        icon={<Crown size={20} weight="fill" />}
        eyebrow="Lionade Pro"
        title="Earn 1.5× Fangs on everything"
        description="Same grind, bigger payout — plus 3 Mastery exams and zero popup ads. $6.99/mo."
        primaryAction={{ label: "See Pro", href: "/pricing" }}
        onDismiss={() => setDismissed(true)}
        dismissLabel="Dismiss Pro upgrade"
      />
    </div>
  );
}
