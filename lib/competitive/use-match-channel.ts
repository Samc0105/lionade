// Competitive platform — client realtime hook.
//
// Subscribes to the per-match Supabase broadcast channel and exposes send +
// per-event handler registration. Used by Sabotage for peer-to-peer attacks and
// by the other modes for lightweight progress/finish sync.
//
// Follows the realtime hard-rules from docs/architecture/lionade-party-realtime.md:
//   - stable unique channel name (competitive-match-<id>)
//   - MANDATORY removeChannel on unmount
//   - broadcast (NOT postgres_changes) for high-frequency peer events
//   - no console.log in the hot path (gated behind a debug flag)

"use client";

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { matchChannel } from "./channels";

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_COMPETITIVE_RT === "1";

type Handler = (payload: Record<string, unknown>) => void;

export function useMatchChannel(matchId: string | null, selfId: string | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const handlersRef = useRef<Map<string, Handler>>(new Map());

  useEffect(() => {
    if (!matchId) return;
    const channel = supabase.channel(matchChannel(matchId), {
      config: { broadcast: { self: false } },
    });

    // One catch-all broadcast listener that dispatches to registered handlers
    // by the payload's `type` field. Keeps re-subscribes cheap.
    channel.on(
      "broadcast",
      { event: "competitive" },
      ({ payload }: { payload: Record<string, unknown> }) => {
        if (DEBUG) console.log("[competitive-rt] recv", payload);
        const type = String(payload?.type ?? "");
        const h = handlersRef.current.get(type);
        if (h) h(payload);
      },
    );

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [matchId]);

  /** Register a handler for a broadcast `type`. Returns an unregister fn. */
  const on = useCallback((type: string, handler: Handler): (() => void) => {
    handlersRef.current.set(type, handler);
    return () => {
      handlersRef.current.delete(type);
    };
  }, []);

  /** Send a broadcast event. The payload should carry a `type` field. */
  const send = useCallback(
    (payload: Record<string, unknown>) => {
      const ch = channelRef.current;
      if (!ch) return;
      ch.send({
        type: "broadcast",
        event: "competitive",
        payload: { ...payload, _from: selfId },
      });
    },
    [selfId],
  );

  return { on, send };
}
