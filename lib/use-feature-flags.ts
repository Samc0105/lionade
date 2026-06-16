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
  status: "live" | "maintenance";
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
 * Live map of every key currently in maintenance (plus any explicit live rows).
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
  /** the flag that caused `down` (or null when live) */
  flag: FeatureFlag | null;
}

/**
 * Resolve the effective maintenance status for a feature key. Walks
 * featureChain(key) = [key, ...ancestors] nearest-first; the first member in
 * maintenance wins (so a sub-feature's own row beats its parent's).
 */
export function useFeatureStatus(key: string): FeatureStatus {
  const flags = useFeatureFlags();
  for (const k of featureChain(key)) {
    const flag = flags[k];
    if (flag && flag.status === "maintenance") {
      return { down: true, downKey: k, flag };
    }
  }
  return { down: false, downKey: null, flag: null };
}
