"use client";

import { SWRConfig } from "swr";
import { swrConfig } from "@/lib/swr-config";

/**
 * Client wrapper that mounts the localStorage-persisted SWR cache
 * provider. Lives in a client component because SWRConfig hooks into the
 * window/document APIs.
 *
 * Hydration-safety note (2026-06-05, revised): we mount the persisted
 * provider on the VERY FIRST client render. This is safe because:
 *
 *   1. `getProvider()` (lib/swr-config) returns an empty `Map` synchronously.
 *      On the first read, useSWR sees no entries — same shape as the server's
 *      "no cache" render — so the DOM matches and hydration is clean.
 *
 *   2. `readyPromise` (the localStorage hydrate) resolves on the next
 *      microtask, NOT synchronously. By the time hydrated entries land in
 *      the Map, React has already finished its first commit. Subsequent
 *      revalidations paint on later frames, never during hydration.
 *
 *   3. The previous implementation swapped providers via a `mounted` flag,
 *      which discarded the SWR cache mid-handshake. That racing the
 *      auth-state flip is what made `/social` blank on cold load and made
 *      cross-nav feel like a full reload (each swap dropped in-memory
 *      revalidations that the 500ms persist-debounce hadn't flushed yet).
 *      Mounting `swrConfig` once eliminates both races.
 *
 * Mount this once at the top of the layout tree, above any component
 * that uses useSWR(). See `/lib/swr-config.ts` for the actual provider
 * behavior.
 */
export default function SwrProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={swrConfig}>{children}</SWRConfig>;
}
