/**
 * lib/use-heartbeat.ts — Presence heartbeat for active sessions.
 *
 * Posts to /api/presence/heartbeat every 10 seconds while the user is in
 * an active session, so the server-side AFK reaper (60s idle timeout)
 * knows the user is still present. Pairs with the `presence_heartbeats`
 * table that the Phase 1 backend wave provisions.
 *
 * Mounted at the TOP of every in-session page:
 *   - /games/party/[code]          → useHeartbeat('party_room', code)
 *   - /compete/arena/[mode]/[id]   → useHeartbeat('arena_match', matchId)
 *   - /learn/mastery/[examId]      → useHeartbeat('mastery_session', sessionId)
 *
 * Both arguments may be null while the page bootstraps (e.g. mastery resolves
 * examId → sessionId asynchronously). Until BOTH are non-null we don't fire
 * — the server doesn't have anything to attribute the heartbeat to.
 *
 * Tab-backgrounded grace:
 *   When the document goes hidden, we continue heartbeating for 30 seconds
 *   so a quick tab-switch (e.g. to check Discord) doesn't get the user
 *   AFK-kicked. After 30s hidden, the interval pauses. When the tab
 *   becomes visible again, we ping immediately + reset the cadence.
 *
 *   This combines with the server-side 60s reaper window: a user who tabs
 *   away has up to 30s of continued heartbeats + the server's 60s grace
 *   = up to 90s before AFK kick. Tunable independently.
 *
 * iOS parity: same hook semantics via AppState + setInterval; the 30s
 * grace maps to the native foreground→background transition timer.
 */

import { useEffect, useRef } from "react";
import { apiPost } from "./api-client";
import type { ActiveSessionType } from "./active-session";

const HEARTBEAT_INTERVAL_MS = 10_000;
const HIDDEN_GRACE_MS = 30_000;

export function useHeartbeat(
  type: ActiveSessionType | null,
  id: string | null,
): void {
  // Stash the latest type/id in a ref so the interval callback always sees
  // the current values without us having to tear down + rebuild the timer
  // each time they change. Saves us from a stutter on the second heartbeat
  // when a parent component re-renders.
  const argsRef = useRef<{ type: ActiveSessionType | null; id: string | null }>({
    type,
    id,
  });
  argsRef.current = { type, id };

  useEffect(() => {
    if (!type || !id) return;

    let cancelled = false;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;
    let hiddenGraceHandle: ReturnType<typeof setTimeout> | null = null;
    let isHidden = false;

    const fireOnce = async () => {
      if (cancelled) return;
      const args = argsRef.current;
      if (!args.type || !args.id) return;
      try {
        await apiPost("/api/presence/heartbeat", { type: args.type, id: args.id });
      } catch {
        // Heartbeat failures are non-fatal — the server reaper will catch
        // a genuinely-gone user; a transient network blip should not toast
        // anything to the user. The next interval tick will try again.
      }
    };

    const startInterval = () => {
      if (intervalHandle) return;
      intervalHandle = setInterval(fireOnce, HEARTBEAT_INTERVAL_MS);
    };

    const stopInterval = () => {
      if (!intervalHandle) return;
      clearInterval(intervalHandle);
      intervalHandle = null;
    };

    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      const nowHidden = document.visibilityState === "hidden";
      if (nowHidden && !isHidden) {
        // Just went hidden — keep beating for HIDDEN_GRACE_MS, then pause.
        isHidden = true;
        if (hiddenGraceHandle) clearTimeout(hiddenGraceHandle);
        hiddenGraceHandle = setTimeout(() => {
          stopInterval();
        }, HIDDEN_GRACE_MS);
      } else if (!nowHidden && isHidden) {
        // Came back visible — cancel any pending pause, ping immediately,
        // and resume the interval cadence.
        isHidden = false;
        if (hiddenGraceHandle) {
          clearTimeout(hiddenGraceHandle);
          hiddenGraceHandle = null;
        }
        void fireOnce();
        startInterval();
      }
    };

    // Fire one heartbeat immediately on mount so the server knows we're
    // here without waiting up to 10s for the first interval tick.
    void fireOnce();
    startInterval();

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      cancelled = true;
      stopInterval();
      if (hiddenGraceHandle) clearTimeout(hiddenGraceHandle);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
    // Re-run when either arg flips between null and non-null. Stable
    // values (same string) won't tear down the interval; the ref
    // pattern above keeps the callback closure fresh on every tick.
  }, [type, id]);
}
