"use client";

import { SWRConfig } from "swr";
import { swrConfig } from "@/lib/swr-config";

/**
 * Client wrapper that mounts the localStorage-persisted SWR cache
 * provider. Lives in a client component because SWRConfig hooks into the
 * window/document APIs.
 *
 * Mount this once at the top of the layout tree, above any component
 * that uses useSWR(). Configured to:
 *   - Hydrate from localStorage on first construction (instant data on
 *     cold open)
 *   - Persist on every cache write (debounced 500ms)
 *   - Persist on tab background + close
 *   - Keep showing cached data while revalidating
 *
 * See `/lib/swr-config.ts` for the actual provider behavior.
 */
export default function SwrProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={swrConfig}>{children}</SWRConfig>;
}
