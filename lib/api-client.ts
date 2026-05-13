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

/**
 * Configured ApiClient singleton — pass this to typed per-feature methods
 * from @lionade/core/api/* (e.g. spinAPI.roll(apiClient)).
 *
 * Prefer apiClient + a typed feature method for new code. The standalone
 * apiGet/apiPost/swrFetcher helpers below are for migration of existing routes.
 */
export const apiClient = createApiClient({
  baseUrl: "", // relative URLs — Next.js routes on same origin
  getToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});

export const apiGet = apiClient.get;
export const apiPost = apiClient.post;
export const apiPatch = apiClient.patch;
export const apiDelete = apiClient.delete;

/**
 * SWR-compatible fetcher that auto-attaches the auth token and THROWS on
 * non-2xx (so SWR's `error` channel populates correctly).
 *
 *   useSWR(`/api/foo`, swrFetcher)
 */
export const swrFetcher = apiClient.swrFetcher;
