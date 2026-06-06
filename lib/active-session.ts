/**
 * lib/active-session.ts — App-level "where is this user right now?" pointer.
 *
 * Reads `profiles.active_session` (JSONB column, see Phase 1 backend wave)
 * via SWR so every page that cares about "is the user mid-session?" reads
 * from the same cached source-of-truth instead of doing its own fetch.
 *
 * Consumers (web Tier 1):
 *   - ResumeBanner    — sticky banner above Navbar when active_session points
 *                       to a page the user isn't currently on.
 *   - AuthProvider    — subscribes to the per-user realtime channel and
 *                       cross-references active_session on every event so
 *                       cross-game redirects know where to send the user.
 *   - In-session pages — call reconnect-on-mount: if URL doesn't match
 *                        active_session.id, redirect to the canonical URL
 *                        (avoids "two tabs in different rooms" drift).
 *
 * iOS parity: same hook shape, TanStack Query or SWR-RN backed. Same shape
 * for the JSON payload because the column is shared.
 */

import { useEffect } from "react";
import useSWR from "swr";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type ActiveSessionType =
  | "party_room"
  | "arena_match"
  | "competitive_match"
  | "mastery_session"
  | "daily_drill"
  | "quiz";

export interface ActiveSession {
  type: ActiveSessionType;
  /** Surface id — room code for parties, match uuid for arena, etc. */
  id: string;
  /** ISO timestamp, set by server on the JOIN flow. */
  joined_at: string;
  /** Optional role (e.g. 'host' | 'guest' for party_room). */
  role?: string;
}

interface ActiveSessionRow {
  active_session: ActiveSession | null;
}

/**
 * Fetcher that goes directly through Supabase RLS (the column lives on the
 * user's own profile row, so RLS already allows the read). We avoid an
 * /api/* route here because (a) the column is cheap, RLS-scoped, and we
 * already hold an auth client for it, and (b) adding an endpoint would
 * add a network hop without adding any auth boundary we don't have.
 */
// Sessions older than this are treated as abandoned client-side even when
// the server pointer still says active. Tightened from 4h to 2h after the
// daily-drill repro: drill pointers shouldn't live this long, mastery
// sittings rarely exceed 2h, and party rooms self-clear via leave/reaper.
// Anything past the threshold is either a forgotten tab or a server leak
// the lifecycle hooks missed.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

// Track the most recent clear-attempt timestamp so a fetch storm during SWR
// revalidation doesn't fire N parallel DELETE /api/user/active-session calls.
// Module-level — survives across the SWR cache.
let lastClearAttemptAt = 0;
const CLEAR_DEDUP_MS = 30_000;

async function fetchActiveSession(userId: string): Promise<ActiveSession | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("active_session")
    .eq("id", userId)
    .single();
  if (error) {
    // The backend wave adds the column; until it ships, the select will
    // 400 with "column does not exist". Treat any error as "no session"
    // so the UI degrades cleanly instead of toasting a scary message.
    return null;
  }
  const raw = (data as ActiveSessionRow | null)?.active_session ?? null;
  if (!raw) return null;

  // Staleness check. Treat as null when:
  //   - joined_at is missing entirely (some legacy daily_drill writes
  //     pre-dated the joined_at field; we can't trust them)
  //   - joined_at is malformed (NaN on parse)
  //   - joined_at is older than STALE_AFTER_MS
  let isStale = false;
  if (!raw.joined_at) {
    isStale = true;
  } else {
    const age = Date.now() - new Date(raw.joined_at).getTime();
    if (!Number.isFinite(age) || age > STALE_AFTER_MS) {
      isStale = true;
    }
  }

  if (isStale) {
    // Auto-reap the server pointer when we detect staleness — so the
    // problem fixes itself across every tab + every device without
    // requiring the user to click the X. Dedup so an SWR revalidation
    // storm doesn't fan out 10 DELETE calls.
    const now = Date.now();
    if (now - lastClearAttemptAt > CLEAR_DEDUP_MS && typeof window !== "undefined") {
      lastClearAttemptAt = now;
      try {
        const mod = await import("@/lib/api-client");
        void mod.apiDelete("/api/user/active-session").catch(() => { /* idempotent */ });
      } catch { /* import or fetch failure — staleness still returns null below */ }
    }
    return null;
  }

  return raw;
}

/**
 * Returns the user's active session pointer, or null when there isn't one.
 * SWR keeps it fresh on focus and every 30s as a safety net for the case
 * where the realtime channel misses an event (network blip, channel
 * resubscribing). Realtime is the FAST path; the 30s poll is the floor.
 */
export function useActiveSession(): {
  session: ActiveSession | null;
  isLoading: boolean;
  mutate: () => void;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { data, isLoading, mutate } = useSWR<ActiveSession | null>(
    userId ? `active-session/${userId}` : null,
    () => fetchActiveSession(userId!),
    {
      revalidateOnFocus: true,
      refreshInterval: 30_000,
      keepPreviousData: true,
      // 404s / RLS hiccups should not retry — the 30s poll already covers
      // recovery and we don't want SWR thrashing on broken column states.
      shouldRetryOnError: false,
    },
  );

  // Listen for postgres_changes on this user's own profile row so the moment
  // a server route (set_active_session RPC, JOIN flow, AFK reaper) writes
  // the column, every open tab refreshes its pointer.
  //
  // We piggy-back on the existing profile-update channel pattern from
  // lib/hooks.ts. Channel name has a random suffix to survive React
  // StrictMode's double-invoke in dev.
  useEffect(() => {
    if (!userId) return;
    const channelName = `active-session:${userId}:${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        () => {
          void mutate();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, mutate]);

  return { session: data ?? null, isLoading, mutate };
}

/**
 * Compute the canonical URL for a given active session. Used by ResumeBanner
 * (to know where to send the user) AND by the cross-game redirect path (to
 * know if the user is already at the right URL).
 *
 * Returns null when the type doesn't map to a stable URL — keeps the caller
 * defensive against future ActiveSessionType values that we haven't taught
 * the router yet.
 */
export function urlForActiveSession(session: ActiveSession): string | null {
  switch (session.type) {
    case "party_room":
      return `/games/party/${session.id}`;
    case "mastery_session":
      // session.id is the EXAM id for mastery — the in-page route resolves
      // exam → active session-id internally (idempotent). This keeps the
      // pointer durable across session-id rotations (e.g. when a session
      // is finalised and a new one is created for the same exam).
      return `/learn/mastery/${session.id}`;
    case "arena_match":
    case "competitive_match":
      // We don't know the [mode] segment from the pointer alone — but the
      // arena hub redirector at /compete/arena handles "open the match I
      // belong to" with just the matchId. The match page itself reads
      // /api/competitive/match/[matchId] which returns the mode.
      return `/compete/arena/match/${session.id}`;
    case "daily_drill":
      return `/learn/paths/${session.id}`;
    case "quiz":
      return `/quiz/${session.id}`;
    default:
      return null;
  }
}

/**
 * Human-readable label for the resume banner. Kept here so the banner copy
 * stays in lockstep with the URL mapping (one switch statement vs two).
 */
export function labelForActiveSession(session: ActiveSession): string {
  switch (session.type) {
    case "party_room":
      return "Resume your party game";
    case "mastery_session":
      return "Resume your Mastery session";
    case "arena_match":
    case "competitive_match":
      return "Resume your arena match";
    case "daily_drill":
      return "Resume your daily drill";
    case "quiz":
      return "Resume your quiz";
    default:
      return "Resume your session";
  }
}
