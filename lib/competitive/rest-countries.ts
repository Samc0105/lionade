// Map Pin Drop — REST Countries API integration (free, no key).
//
// We fetch country names + latlng centroids from restcountries.com and cache
// them in-memory (24h TTL). These merge with the curated landmark/city set in
// lib/competitive/pin-places.ts at round-generation time so the prompt pool is
// large and varied. Falls back gracefully to the curated set if the API is
// unreachable.

import type { PinPlace } from "./pin-places";

interface RestCountry {
  name: { common: string };
  latlng?: [number, number];
  independent?: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cache: PinPlace[] = [];
let cacheLoadedAt = 0;

async function refresh(): Promise<void> {
  try {
    const url = "https://restcountries.com/v3.1/all?fields=name,latlng,independent";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`restcountries ${res.status}`);
    const data = (await res.json()) as RestCountry[];
    cache = data
      .filter((c) => c.independent !== false && Array.isArray(c.latlng) && c.latlng.length === 2)
      .map((c) => ({
        id: `country-${c.name.common.toLowerCase().replace(/[^a-z]/g, "")}`,
        prompt: c.name.common,
        lat: c.latlng![0],
        lng: c.latlng![1],
        kind: "city" as const,
      }));
    cacheLoadedAt = Date.now();
  } catch (e) {
    console.warn(
      "[rest-countries] fetch failed, using curated places only:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Returns cached country centroids (refreshing if stale). Empty on hard failure. */
export async function getCountryPlaces(): Promise<PinPlace[]> {
  const stale = Date.now() - cacheLoadedAt > CACHE_TTL_MS;
  if (cache.length === 0 || stale) {
    await refresh();
  }
  return cache;
}
