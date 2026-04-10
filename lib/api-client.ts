// Client-side API helper. Auto-attaches the Supabase access token to outgoing
// requests so server routes can authenticate the caller via Authorization
// Bearer header.
//
// Usage:
//   import { apiPost, apiGet } from "@/lib/api-client";
//   const { ok, data, error } = await apiPost<{ profile: Profile }>("/api/save-quiz-results", payload);
//
// Always prefer apiPost/apiGet over raw fetch() for /api/* routes that need
// auth. The helper handles 401 transparently and never sends a request if the
// session is missing.

import { supabase } from "./supabase";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function call<T>(
  url: string,
  init: RequestInit,
): Promise<ApiResult<T>> {
  const token = await getAccessToken();
  if (!token) {
    return { ok: false, status: 401, data: null, error: "Not signed in" };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  try {
    const res = await fetch(url, { ...init, headers });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // non-JSON response
    }
    if (!res.ok) {
      const err =
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : `Request failed (${res.status})`;
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

export function apiPost<T = unknown>(url: string, body?: unknown): Promise<ApiResult<T>> {
  return call<T>(url, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiGet<T = unknown>(url: string): Promise<ApiResult<T>> {
  return call<T>(url, { method: "GET" });
}

export function apiPatch<T = unknown>(url: string, body?: unknown): Promise<ApiResult<T>> {
  return call<T>(url, {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T = unknown>(url: string): Promise<ApiResult<T>> {
  return call<T>(url, { method: "DELETE" });
}

/**
 * SWR-compatible fetcher that auto-attaches the auth token and THROWS on
 * non-2xx (so SWR's `error` channel populates correctly).
 *
 *   useSWR(`/api/foo`, swrFetcher)
 */
export async function swrFetcher<T = unknown>(url: string): Promise<T> {
  const res = await apiGet<T>(url);
  if (!res.ok) throw new Error(res.error ?? `Request failed (${res.status})`);
  return res.data as T;
}
