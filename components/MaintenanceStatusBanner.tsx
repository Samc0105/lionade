"use client";

// Global status banner — a slim, dismissible top bar that surfaces EVERY
// feature currently in an effective warning or maintenance state, anywhere on
// the site. It is purely INFORMATIONAL: it never blocks a page, never hides
// the nav, and never replaces content. The per-surface FeatureGate /
// MaintenanceGate handle the actual gating; this just gives a calm, app-wide
// heads-up so a degraded feature is discoverable from any page.
//
// Reads useFeatureFlags() (the public endpoint already pre-resolves scheduling
// windows, so a present key is always an active warning/maintenance). Staff see
// it too — it is the same informational signal for everyone.
//
// FAIL-OPEN: when the flag map is empty (no overrides, or an unreadable flag
// service) nothing renders. A monitoring banner must never itself break a page.
//
// Dismissal persists in sessionStorage, keyed by the exact set of affected
// feature keys, so dismissing it stops the nag for this tab session but a NEW
// feature going into maintenance produces a fresh (different-key) banner the
// user has not dismissed yet.

import { useEffect, useMemo, useState } from "react";
import { Warning, X } from "@phosphor-icons/react";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { getFeature } from "@/lib/features/catalog";

const STORAGE_PREFIX = "lionade.statusBannerDismissed.";

export default function MaintenanceStatusBanner() {
  const flags = useFeatureFlags();

  // Stable, deterministic list of affected features. Maintenance is listed
  // first, then warnings; within each, sorted by key so the dismissal signature
  // is order-independent. Human label via the catalog, falling back to the raw
  // key for any node not in the catalog.
  const affected = useMemo(() => {
    const entries = Object.entries(flags);
    const maintenance: string[] = [];
    const warning: string[] = [];
    for (const [key, flag] of entries) {
      if (flag.status === "maintenance") maintenance.push(key);
      else if (flag.status === "warning") warning.push(key);
    }
    maintenance.sort();
    warning.sort();
    const toItem = (key: string) => ({
      key,
      label: getFeature(key)?.label ?? key,
    });
    return {
      maintenance: maintenance.map(toItem),
      warning: warning.map(toItem),
      // Order-independent signature of the affected set, used to scope the
      // per-session dismissal so a new flag re-shows the bar.
      signature: [...maintenance, ...warning].join("|"),
    };
  }, [flags]);

  const hasAny = affected.maintenance.length > 0 || affected.warning.length > 0;

  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  // Read any prior dismissal for the CURRENT affected set after mount.
  // sessionStorage is unavailable during SSR, so reading it in an effect keeps
  // hydration clean.
  useEffect(() => {
    if (!hasAny) return;
    try {
      if (sessionStorage.getItem(STORAGE_PREFIX + affected.signature) === "1") {
        setDismissedSignature(affected.signature);
      }
    } catch {
      // sessionStorage blocked (private mode / strict settings): show the bar
      // rather than suppress it. Fail toward informing the user.
    }
  }, [hasAny, affected.signature]);

  // Fail-open: nothing flagged => render nothing.
  if (!hasAny) return null;
  // Already dismissed for this exact set of features this session.
  if (dismissedSignature === affected.signature) return null;

  const dismiss = () => {
    setDismissedSignature(affected.signature);
    try {
      sessionStorage.setItem(STORAGE_PREFIX + affected.signature, "1");
    } catch {
      // Non-fatal: the bar still hides for this render.
    }
  };

  // Build a calm, dash-free sentence. Maintenance and warnings are phrased
  // separately so the wording stays honest about which features are down vs
  // merely flaky.
  const maintenanceLabels = affected.maintenance.map((i) => i.label);
  const warningLabels = affected.warning.map((i) => i.label);
  const parts: string[] = [];
  if (maintenanceLabels.length > 0) {
    parts.push(`Some features are in maintenance: ${maintenanceLabels.join(", ")}.`);
  }
  if (warningLabels.length > 0) {
    parts.push(`Heads up on a known issue with: ${warningLabels.join(", ")}.`);
  }
  const message = parts.join(" ");

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-gold/25 bg-gold/10 px-4 py-2 text-center"
    >
      <Warning
        weight="duotone"
        size={16}
        className="shrink-0 text-gold"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-xs text-cream/85 sm:text-sm sm:whitespace-normal">
        {message}
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss status notice"
        className="shrink-0 rounded-lg p-1 text-cream/50 transition-colors hover:bg-white/10 hover:text-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        <X weight="bold" size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
