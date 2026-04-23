"use client";

import { useEffect, useRef } from "react";
import { apiPost } from "@/lib/api-client";

/**
 * Tracks "active" time on a Mastery Mode session and POSTs 10-second
 * heartbeat deltas to the server. Time is only credited when:
 *   - The page is visible (document.visibilityState === "visible")
 *   - The user has interacted in the last 60 seconds
 *
 * AFK = either condition fails. The server clamps each delta to 15s so a
 * tab paused mid-stream doesn't backfill bogus time when it resumes.
 */

const HEARTBEAT_INTERVAL_MS = 10_000;
const ACTIVITY_WINDOW_MS = 60_000;

export function useActiveTime(sessionId: string | null) {
  const lastInteractionRef = useRef<number>(Date.now());
  const lastBeatRef = useRef<number>(Date.now());
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;

    const markInteraction = () => { lastInteractionRef.current = Date.now(); };
    const events: (keyof WindowEventMap)[] = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    for (const e of events) window.addEventListener(e, markInteraction, { passive: true });
    window.addEventListener("focus", markInteraction);

    const sendBeat = async () => {
      if (inFlightRef.current) return;
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      const sinceInteraction = now - lastInteractionRef.current;
      if (sinceInteraction > ACTIVITY_WINDOW_MS) return; // AFK

      const deltaMs = Math.min(HEARTBEAT_INTERVAL_MS + 5000, now - lastBeatRef.current);
      const deltaSeconds = Math.max(1, Math.round(deltaMs / 1000));

      inFlightRef.current = true;
      try {
        await apiPost(`/api/mastery/sessions/${sessionId}/heartbeat`, { deltaSeconds });
        lastBeatRef.current = now;
      } catch { /* silent — heartbeats are best-effort */ }
      finally { inFlightRef.current = false; }
    };

    const interval = setInterval(sendBeat, HEARTBEAT_INTERVAL_MS);

    // Send one final beat on hide so short sessions don't zero-out
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        // Use keepalive semantics by not awaiting — browser flushes on unload.
        void sendBeat();
      }
    };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      clearInterval(interval);
      for (const e of events) window.removeEventListener(e, markInteraction);
      window.removeEventListener("focus", markInteraction);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [sessionId]);
}
