/**
 * Platform-agnostic HTTP client for Lionade API routes.
 *
 * Both web (Next.js) and iOS (Expo) call into this. They configure it with
 * their own auth-token getter, base URL, and (optionally) fetch impl.
 *
 * The shape of the returned methods matches the existing apiGet/apiPost
 * helpers in both apps, so a re-export shim is enough to migrate consumers.
 *
 * Usage:
 *   import { createApiClient } from '@lionade/core/api';
 *
 *   const api = createApiClient({
 *     baseUrl: '',                       // web: relative URLs; iOS: 'https://getlionade.com'
 *     getToken: async () => session?.access_token ?? null,
 *   });
 *
 *   const { ok, data, error } = await api.post<{ profile: Profile }>('/api/save-quiz-results', payload);
 */

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiClientConfig {
  /** Prefix prepended to every path. Empty string for web (relative), full origin for iOS. */
  baseUrl: string;
  /** Async getter for the auth bearer token. Return null if not signed in. */
  getToken: () => Promise<string | null> | string | null;
  /** Optional custom fetch impl. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /** If true, requests without a token return ok:false with status 401 instead of being sent. Default true. */
  requireAuth?: boolean;
}

export interface ApiClient {
  get: <T = unknown>(path: string) => Promise<ApiResult<T>>;
  post: <T = unknown>(path: string, body?: unknown) => Promise<ApiResult<T>>;
  patch: <T = unknown>(path: string, body?: unknown) => Promise<ApiResult<T>>;
  delete: <T = unknown>(path: string) => Promise<ApiResult<T>>;
  /** SWR-compatible fetcher that throws on non-2xx so SWR's error channel populates. */
  swrFetcher: <T = unknown>(path: string) => Promise<T>;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const requireAuth = config.requireAuth ?? true;

  async function call<T>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResult<T>> {
    const token = await config.getToken();
    if (requireAuth && !token) {
      return { ok: false, status: 401, data: null, error: "Not signed in" };
    }

    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const url = `${config.baseUrl}${path}`;

    try {
      const res = await fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // non-JSON or empty body — fall through
      }

      if (!res.ok) {
        const err =
          parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: unknown }).error)
            : `${method} ${path} → ${res.status}`;
        return { ok: false, status: res.status, data: parsed as T | null, error: err };
      }

      return { ok: true, status: res.status, data: parsed as T };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        data: null,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  }

  return {
    get: <T = unknown>(path: string) => call<T>("GET", path),
    post: <T = unknown>(path: string, body?: unknown) => call<T>("POST", path, body),
    patch: <T = unknown>(path: string, body?: unknown) => call<T>("PATCH", path, body),
    delete: <T = unknown>(path: string) => call<T>("DELETE", path),
    swrFetcher: async <T = unknown>(path: string): Promise<T> => {
      const res = await call<T>("GET", path);
      if (!res.ok) throw new Error(res.error ?? `Request failed (${res.status})`);
      return res.data as T;
    },
  };
}
