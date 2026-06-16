"use client";

// Dismissible "known issue" banner for a feature in the WARNING state.
//
// Unlike maintenance (which replaces the surface), a warning leaves the
// feature fully usable and the API unblocked. This banner sits above the
// feature so people know the surface may be flaky, then lets them dismiss it.
//
// Dismissal persists in sessionStorage keyed by the feature key, so it does
// not nag for the rest of the tab session but reappears in a fresh session if
// the issue is still flagged. The message and optional ETA come straight from
// the admin feature-flag panel.
//
// FAIL-OPEN by inheritance: this only renders when useFeatureStatus already
// resolved a warning, and a missing flag never reaches here.

import { useEffect, useState } from "react";
import { Warning, X } from "@phosphor-icons/react";
import type { FeatureFlag } from "@/lib/use-feature-flags";

interface FeatureWarningBannerProps {
  /** the warning flag (message + optional eta) */
  flag: FeatureFlag | null;
  /** the catalog key in warning, used to scope the per-session dismissal */
  featureKey: string;
}

const STORAGE_PREFIX = "lionade.featureWarnDismissed.";

export default function FeatureWarningBanner({ flag, featureKey }: FeatureWarningBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  // Read any prior dismissal for this key after mount (sessionStorage is not
  // available during SSR; reading it in an effect keeps hydration clean).
  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_PREFIX + featureKey) === "1") {
        setDismissed(true);
      }
    } catch {
      // sessionStorage blocked (private mode / strict settings): show the
      // banner rather than suppress it. Fail toward informing the user.
    }
  }, [featureKey]);

  if (dismissed) return null;

  const message =
    flag?.message?.trim() ||
    "We're aware of an issue with this part of Lionade and are on it. You can keep using it for now.";
  const eta = flag?.eta?.trim() || null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(STORAGE_PREFIX + featureKey, "1");
    } catch {
      // Non-fatal: the banner still hides for this render, it may just return
      // on the next mount.
    }
  };

  return (
    <div
      role="status"
      className="relative mb-4 flex items-start gap-3 rounded-2xl border border-gold/30 bg-gold/10 backdrop-blur px-4 py-3"
    >
      <Warning
        weight="duotone"
        size={20}
        className="mt-0.5 shrink-0 text-gold"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold/80">
          Known issue
        </p>
        <p className="mt-1 text-sm leading-relaxed text-cream/85">{message}</p>
        {eta ? (
          <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-cream/45">
            Expected fix by {eta}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        className="shrink-0 rounded-lg p-1 text-cream/50 transition-colors hover:bg-white/10 hover:text-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        <X weight="bold" size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
