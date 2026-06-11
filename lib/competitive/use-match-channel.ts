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
//
// Resilience (2026-06): the subscription now rides subscribeResilient, the same
// exponential-backoff reconnect wrapper Party uses (SketchView / BluffView /
// PokerFaceView / room-state). A transient WS drop re-subscribes automatically
// without the consumer re-registering handlers — the broadcast listener + the
// handler map are attached to a STABLE channel object, so re-subscribe never
// re-attaches them.
//
// Peer presence (2026-06): we ALSO track Supabase Realtime Presence on the same
// channel. Each client track()s its own userId on every successful subscribe
// (including reconnects), and we listen to presence sync/join/leave to derive
// whether the OPPONENT is currently connected. Presence composes cleanly with
// subscribeResilient because:
//   - presence listeners (like the broadcast listener) are attached ONCE to the
//     stable channel object before the first subscribe — they survive re-subscribe.
//   - track() lives in onSubscribed, which subscribeResilient fires on EVERY
//     successful (re)subscribe, so a reconnect re-announces our presence with no
//     extra bookkeeping. Supabase replaces (does not stack) our presence row
//     because it is keyed by the channel's presence key.
// This is why we pick Presence over a hand-rolled "alive" beacon: no separate
// interval, no staleness timer, and reconnect re-tracking is free.

"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { matchChannel } from "./channels";
import { subscribeResilient } from "@/lib/realtime-resilient";

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_COMPETITIVE_RT === "1";

type Handler = (payload: Record<string, unknown>) => void;

export type MatchConnectionState = "connecting" | "connected" | "reconnecting";

// Shape we track() into presence. Kept tiny — presence payloads are gossiped to
// every member, so we only carry what's needed to identify the peer.
interface MatchPresenceMeta {
  userId: string;
}

export interface UseMatchChannelResult {
  /** Register a handler for a broadcast `type`. Returns an unregister fn. */
  on: (type: string, handler: Handler) => () => void;
  /** Send a broadcast event. The payload should carry a `type` field. */
  send: (payload: Record<string, unknown>) => void;
  /** This client's own channel connection state. */
  connection: MatchConnectionState;
  /** True while at least one opponent userId is present on the channel. */
  opponentPresent: boolean;
  /** ms timestamp (Date.now) of the last time an opponent was seen present,
   *  or null if no opponent has ever been observed this session. */
  opponentLastSeen: number | null;
}

/**
 * Subscribe to a match channel with reconnect + opponent presence.
 *
 * @param matchId      the match UUID (channel = competitive-match-<id>)
 * @param selfId       this client's user id (stamped on outgoing sends + tracked
 *                     into presence)
 * @param opponentIds  the opponent user id(s). Used ONLY to decide whether a
 *                     present member counts as "the opponent." May be omitted
 *                     (legacy 2-arg callers) — then opponentPresent stays false
 *                     but send/on still work unchanged.
 */
export function useMatchChannel(
  matchId: string | null,
  selfId: string | null,
  opponentIds?: readonly string[],
): UseMatchChannelResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const handlersRef = useRef<Map<string, Handler>>(new Map());

  const [connection, setConnection] = useState<MatchConnectionState>("connecting");
  const [opponentPresent, setOpponentPresent] = useState(false);
  const [opponentLastSeen, setOpponentLastSeen] = useState<number | null>(null);

  // Keep opponent ids in a ref so the presence handler (registered once) always
  // reads the current set without us re-creating the channel when the list
  // identity changes. The set of opponents for a given match is effectively
  // stable, but this keeps us safe against a re-render passing a new array.
  const opponentSetRef = useRef<Set<string>>(new Set());
  opponentSetRef.current = new Set(opponentIds ?? []);

  // selfId may arrive a tick after matchId. Stash in a ref so the (matchId-keyed)
  // effect reads the freshest value when it track()s presence + stamps sends.
  const selfIdRef = useRef<string | null>(selfId);
  selfIdRef.current = selfId;

  useEffect(() => {
    if (!matchId) return;

    setConnection("connecting");
    setOpponentPresent(false);

    const channel = supabase.channel(matchChannel(matchId), {
      config: {
        broadcast: { self: false },
        // presence key = this client's userId so reconnect track() REPLACES our
        // own row instead of stacking a second ghost presence for us.
        presence: { key: selfIdRef.current ?? undefined },
      },
    });

    // ── Broadcast: one catch-all listener that dispatches to registered
    // handlers by the payload's `type`. Attached ONCE to this channel object;
    // survives every re-subscribe (we never re-create the channel on reconnect).
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

    // ── Presence: derive whether the opponent is connected from the channel's
    // presence state. Registered ONCE (like the broadcast listener) so reconnect
    // never stacks a second presence subscription.
    const recomputeOpponent = () => {
      // presenceState(): { [key]: Array<{ userId, ... }> }
      const state = channel.presenceState() as Record<string, MatchPresenceMeta[]>;
      const opponents = opponentSetRef.current;
      const me = selfIdRef.current;
      let present = false;
      for (const metas of Object.values(state)) {
        for (const meta of metas) {
          const uid = meta?.userId;
          if (!uid || uid === me) continue;
          // If we know the opponent set, require a match; otherwise any non-self
          // member counts (defensive — legacy callers won't pass opponentIds and
          // get opponentPresent=false because the loop below `continue`s).
          if (opponents.size === 0) continue;
          if (opponents.has(uid)) {
            present = true;
            break;
          }
        }
        if (present) break;
      }
      setOpponentPresent(present);
      if (present) setOpponentLastSeen(Date.now());
    };

    channel.on("presence", { event: "sync" }, recomputeOpponent);
    channel.on("presence", { event: "join" }, recomputeOpponent);
    channel.on("presence", { event: "leave" }, recomputeOpponent);

    // ── Resilient subscribe. track() lives in onSubscribed so it fires on the
    // initial connect AND on every reconnect — re-announcing our presence after
    // a drop. onUnsubscribed flips us to "reconnecting" so the UI can surface it.
    let hasSubscribedOnce = false;
    const handle = subscribeResilient(channel, {
      label: `competitive-match:${matchId}`,
      // The match-screen surfaces connectivity itself (banner / forfeit prompt),
      // so suppress the generic "Connection lost" toast for this channel.
      silentOnGiveUp: true,
      onSubscribed: () => {
        hasSubscribedOnce = true;
        setConnection("connected");
        const me = selfIdRef.current;
        if (me) {
          // track() is idempotent per presence key — a reconnect replaces our
          // row rather than adding a duplicate.
          void channel.track({ userId: me } satisfies MatchPresenceMeta);
        }
        // Re-derive opponent presence immediately on (re)connect; a sync event
        // follows, but this avoids a flash of stale state.
        recomputeOpponent();
      },
      onUnsubscribed: () => {
        // First unsubscribe before we've ever connected is still "connecting".
        setConnection(hasSubscribedOnce ? "reconnecting" : "connecting");
        // We can no longer see peers while disconnected. Keep opponentLastSeen
        // as-is so the UI can show "last seen Xs ago."
        setOpponentPresent(false);
      },
    });
    channelRef.current = channel;

    return () => {
      // Order matters: stop the wrapper from scheduling retries, untrack our
      // presence, THEN remove the channel. removeChannel tears down all attached
      // listeners (broadcast + presence) so nothing leaks across remounts.
      handle.cancel();
      void channel.untrack();
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
  const send = useCallback((payload: Record<string, unknown>) => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.send({
      type: "broadcast",
      event: "competitive",
      payload: { ...payload, _from: selfIdRef.current },
    });
  }, []);

  return { on, send, connection, opponentPresent, opponentLastSeen };
}
