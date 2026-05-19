"use client";

import { useState } from "react";
import useSWR from "swr";
import { Coin } from "@phosphor-icons/react";
import { swrFetcher } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import ClaimBanner from "@/components/ClaimBanner";

/**
 * Tiny dashboard chip that nudges the user to claim their daily Fangs
 * via the gold "Daily" pill in the navbar. Auto-hides when the daily
 * isn't available (just claimed, or still on cooldown), so there's no
 * extra dismiss state — the natural lifecycle handles it.
 *
 * First-time users (lifetimeFangs == 0) get a slightly different copy
 * since this is also the first reward they'll ever earn. We removed the
 * signup-bonus deposit; this chip is the breadcrumb that replaces it.
 *
 * Visual shell = <ClaimBanner variant="gold" size="pill">. Claim logic
 * lives in the navbar's ClockInButton; this remains a pure breadcrumb,
 * so the banner has no primaryAction (matches prior behavior).
 */

interface StatusResponse {
  available: boolean;
  nextAmount: number;
  lifetimeFangs: number;
  totalClaims: number;
}

export default function DailyReadyNudge() {
  const { user } = useAuth();
  // Same key the navbar's ClockInButton already uses → SWR dedupes the
  // fetch, so this widget is effectively free.
  const { data } = useSWR<StatusResponse>(
    user?.id ? "/api/login-bonus" : null,
    swrFetcher,
    { revalidateOnFocus: true },
  );
  const [dismissed, setDismissed] = useState(false);

  if (!user?.id) return null;
  if (!data?.available) return null;
  if (dismissed) return null;

  const isFirstClaim = data.totalClaims === 0;

  return (
    <div className="mb-4 animate-slide-up" style={{ animationDelay: "0.02s" }}>
      <ClaimBanner
        variant="gold"
        size="pill"
        role="region"
        ariaLabel="Daily Fangs ready to claim"
        icon={<Coin size={13} weight="fill" />}
        title={isFirstClaim ? "Welcome." : "Daily Fangs are ready."}
        description={
          isFirstClaim
            ? `Tap the gold pill up top for your first ${data.nextAmount} Fangs.`
            : "Cash out from the gold pill in the navbar."
        }
        meta={<>&uarr; +{data.nextAmount}F</>}
        onDismiss={() => setDismissed(true)}
        dismissLabel="Dismiss reminder"
      />
    </div>
  );
}
