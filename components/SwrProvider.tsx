"use client";

import { useEffect, useMemo, useState } from "react";
import { SWRConfig } from "swr";
import { swrConfig, swrConfigNoPersist } from "@/lib/swr-config";

/**
 * Client wrapper that mounts the localStorage-persisted SWR cache
 * provider. Lives in a client component because SWRConfig hooks into the
 * window/document APIs.
 *
 * Hydration-safety note (2026-05-26): the FIRST client render must paint
 * the exact same DOM the server painted. The server has no localStorage,
 * so server-rendered subtrees show their loading/skeleton state. If the
 * persisted-cache provider mounts on the client's first render, useSWR
 * hooks immediately see hydrated data and paint the data DOM instead —
 * which gives React a `Did not expect server HTML to contain a <div> in
 * <div>` mismatch and tears down the whole tree.
 *
 * Fix: gate the persisted provider behind a `mounted` flag. First render
 * (server + client hydration) uses a plain in-memory provider that
 * matches the server's "no cache" state. After the post-hydration
 * `useEffect` flips `mounted` to true, we swap to the persisted provider
 * and the cache hydrates from localStorage on next render. The SWR cache
 * is re-mounted across the swap, so hooks may fire one extra revalidation
 * — acceptable trade-off for clean hydration.
 *
 * Mount this once at the top of the layout tree, above any component
 * that uses useSWR(). See `/lib/swr-config.ts` for the actual provider
 * behavior.
 */
export default function SwrProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // useMemo so we don't re-create the config object on every render once
  // mounted flips — keeps SWRConfig's `value` referentially stable.
  const value = useMemo(
    () => (mounted ? swrConfig : swrConfigNoPersist),
    [mounted],
  );

  return <SWRConfig value={value}>{children}</SWRConfig>;
}
