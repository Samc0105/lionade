import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "lionade-auth",
    // Default is 30s, which means any contested nav-lock stalls auth
    // boot for up to 30 seconds — that's the tail of the "login bounce
    // back to form" bug. 3s is still generous for a legitimate cross-
    // tab refresh and keeps the boot fast.
    lockAcquireTimeout: 3000,
  } as any,
});

/**
 * Synchronously peek at the persisted auth session from localStorage.
 *
 * Supabase's getSession() / onAuthStateChange are ultimately async and
 * can stall behind the nav-lock, token refresh, or service-worker
 * races. When we're bootstrapping a page (dashboard after login, a
 * refresh mid-session) we don't want to wait — if the session token is
 * right there in storage and still valid, use it immediately. The
 * Supabase client will validate/refresh in the background.
 *
 * Returns the raw session object (access_token + user + expires_at)
 * or null if nothing's stored / it's expired / parsing failed. Never
 * throws — safe to call on the server (SSR always returns null).
 */
export function readStoredSessionSync(): {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("lionade-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Supabase v2 stores { currentSession, expiresAt, ... } in some
    // historical formats and the session directly in others. Handle both.
    const session = parsed?.currentSession ?? parsed;
    if (!session?.access_token || !session?.user?.id) return null;
    // Reject obviously-expired tokens so we don't boot into an unusable
    // state. `expires_at` is a unix timestamp in seconds.
    if (typeof session.expires_at === "number") {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec > session.expires_at) return null;
    }
    return session;
  } catch {
    return null;
  }
}
