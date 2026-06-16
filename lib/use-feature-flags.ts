"use client";

// Client-side reader for the feature-flag / maintenance kill-switch.
//
// FAIL-OPEN by design: the public /api/feature-flags endpoint returns
// { flags: {} } on any server error, and useFeatureFlags() returns {} when
// SWR has no data. A monitoring system must never itself take the site down,
// so an unreachable flag service reads as "everything live".
//
// The endpoint is PUBLIC (no auth) so logged-out visitors and edge prefetches
// can read flag state. We deliberately use a bare fetcher with NO auth header
// (NOT swrFetcher), since attaching a token here would be pointless and would
// vary the cache key by session.

import useSWR from "swr";
import { featureChain } from "@/lib/features/catalog";

export interface FeatureFlag {
  // The public /api/feature-flags endpoint PRE-RESOLVES scheduling windows
  // (starts_at / ends_at), so by the time a status reaches the client it is
  // already the effective status. The client never recomputes windows.
  // 'live' rows are omitted from the map entirely (a missing key = live), but
  // the type keeps it for completeness.
  status: "live" | "warning" | "maintenance";
  message: string | null;
  eta: string | null;
}

export type FeatureFlagMap = Record<string, FeatureFlag>;

/**
 * Plain fetch with no auth header. Returns { flags: {} } on any failure so the
 * hook below stays fail-open even if SWR were configured to retain the value.
 */
async function barePublicFetcher(url: string): Promise<{ flags: FeatureFlagMap }> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return { flags: {} };
    const json = (await res.json()) as { flags?: FeatureFlagMap };
    return { flags: json.flags ?? {} };
  } catch {
    return { flags: {} };
  }
}

/**
 * Live map of every key currently in effective warning or maintenance. The
 * public endpoint omits 'live' keys and has already pre-resolved scheduling
 * windows, so a present row is always an active warning/maintenance state.
 * Returns {} when there is no data (fail-open). Polls every 45s so a lift/drop
 * propagates to open tabs without a refresh.
 */
export function useFeatureFlags(): FeatureFlagMap {
  const { data } = useSWR<{ flags: FeatureFlagMap }>(
    "/api/feature-flags",
    barePublicFetcher,
    {
      refreshInterval: 45000,
      revalidateOnFocus: true,
      keepPreviousData: true,
      // Never retry-spam a degraded flag service; one miss reads as all-live.
      shouldRetryOnError: false,
    },
  );
  return data?.flags ?? {};
}

export interface FeatureStatus {
  /** true when this key OR any dot-path ancestor is in maintenance */
  down: boolean;
  /** the nearest key in the chain that is down (self wins over ancestor) */
  downKey: string | null;
  /**
   * true when this key OR any ancestor is in warning AND nothing in the chain
   * is in maintenance. Maintenance always beats warning, so `warn` is never
   * true at the same time as `down`.
   */
  warn: boolean;
  /** the nearest key in the chain that is in warning (only when warn) */
  warnKey: string | null;
  /**
   * the flag that drives the status: the maintenance flag when `down`, else the
   * warning flag when `warn`, else null when live.
   */
  flag: FeatureFlag | null;
}

/**
 * Resolve the effective status for a feature key. The public endpoint has
 * already pre-resolved scheduling windows, so the client only walks the chain.
 *
 * Walks featureChain(key) = [key, ...ancestors] nearest-first. Maintenance
 * anywhere in the chain wins (so the surface is replaced); otherwise the
 * nearest warning wins (the surface stays usable with a known-issue banner).
 * The nearest member of each kind is preferred so a sub-feature's own row beats
 * its parent's.
 */
export function useFeatureStatus(key: string): FeatureStatus {
  const flags = useFeatureFlags();
  const chain = featureChain(key);

  // Pass 1: maintenance always wins, nearest-first.
  for (const k of chain) {
    const flag = flags[k];
    if (flag && flag.status === "maintenance") {
      return { down: true, downKey: k, warn: false, warnKey: null, flag };
    }
  }

  // Pass 2: no maintenance in the chain, so the nearest warning (if any) wins.
  for (const k of chain) {
    const flag = flags[k];
    if (flag && flag.status === "warning") {
      return { down: false, downKey: null, warn: true, warnKey: k, flag };
    }
  }

  return { down: false, downKey: null, warn: false, warnKey: null, flag: null };
}
