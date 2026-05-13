/**
 * Web HTTP client — thin wrapper around @lionade/core's createApiClient.
 *
 * Configures the shared client with web-specific concerns (relative URLs,
 * Supabase session getter). Public surface (apiGet/apiPost/apiPatch/apiDelete/
 * swrFetcher) is unchanged so existing imports keep working.
 *
 * Usage:
 *   import { apiPost, swrFetcher } from "@/lib/api-client";
 *   const { ok, data, error } = await apiPost<{ profile: Profile }>("/api/save-quiz-results", payload);
 */
import { createApiClient, type ApiResult } from "@lionade/core/api";
import { supabase } from "./supabase";

export type { ApiResult };

const client = createApiClient({
  baseUrl: "", // relative URLs — Next.js routes on same origin
  getToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});

export const apiGet = client.get;
export const apiPost = client.post;
export const apiPatch = client.patch;
export const apiDelete = client.delete;

/**
 * SWR-compatible fetcher that auto-attaches the auth token and THROWS on
 * non-2xx (so SWR's `error` channel populates correctly).
 *
 *   useSWR(`/api/foo`, swrFetcher)
 */
export const swrFetcher = client.swrFetcher;
