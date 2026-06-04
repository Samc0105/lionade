/**
 * lib/realtime-resilient.ts — Reconnect-with-backoff wrapper for Supabase
 * realtime channels.
 *
 * Why: the existing channelRef + subscribedRef pattern across SketchView /
 * SketchCanvas / BluffView / PokerFaceView calls `ch.subscribe()` once and
 * leaves the channel dead if it ever hits `CHANNEL_ERROR` / `TIMED_OUT`.
 * In practice this happens on:
 *   - Brief Wi-Fi drops on mobile.
 *   - Hotel / corporate networks that throttle long-lived WS connections.
 *   - Supabase realtime worker restarts (rare but real).
 *
 * Strategy:
 *   - Wrap `subscribe()` so we capture status transitions.
 *   - On CHANNEL_ERROR / TIMED_OUT, schedule a re-subscribe via exponential
 *     backoff: 1s, 2s, 4s, 8s, 16s.
 *   - After 5 consecutive failures, emit ONE toast: "Connection lost. Try
 *     refreshing." — and stop retrying. The user can choose to refresh or
 *     keep the stale state visible.
 *   - A SUBSCRIBED status resets the retry counter (success after partial
 *     failures shouldn't count against the next outage).
 *
 * Usage (drop-in for the existing pattern):
 *
 *   const ch = supabase.channel(name);
 *   ch.on('broadcast', ..., handler);
 *   // BEFORE:  ch.subscribe((status) => { ... })
 *   // AFTER:
 *   const handle = subscribeResilient(ch, {
 *     onSubscribed: () => { subscribedRef.current = true; },
 *     onUnsubscribed: () => { subscribedRef.current = false; },
 *   });
 *   // Teardown:
 *   handle.cancel();
 *   supabase.removeChannel(ch);
 *
 * The wrapper does NOT call supabase.removeChannel — the caller still owns
 * channel lifecycle. We only call .subscribe() (potentially multiple times)
 * on the same channel handle.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { toastError } from "./toast";

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;

export interface ResilientHandle {
  /** Stop the wrapper from scheduling any further retries. */
  cancel: () => void;
}

export interface SubscribeResilientOpts {
  /** Called whenever the channel reaches SUBSCRIBED. May fire multiple times
   *  across a session (initial subscribe + reconnects). */
  onSubscribed?: () => void;
  /** Called whenever the channel leaves SUBSCRIBED (CLOSED / CHANNEL_ERROR /
   *  TIMED_OUT). Lets callers flip their `subscribedRef` to false so any
   *  outgoing broadcast knows not to fire into a dead channel. */
  onUnsubscribed?: () => void;
  /** Disable the "Connection lost" toast at the end of MAX_ATTEMPTS. Useful
   *  for channels where we already surface connectivity another way. */
  silentOnGiveUp?: boolean;
  /** Label used in console logs to disambiguate which surface failed. */
  label?: string;
}

export function subscribeResilient(
  channel: RealtimeChannel,
  opts: SubscribeResilientOpts = {},
): ResilientHandle {
  let cancelled = false;
  let attemptsAfterFailure = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  // Track whether we've ever reached SUBSCRIBED at least once. The first
  // .subscribe() call is "initial connect," not a retry — we don't want to
  // surface a toast just because the very first subscribe attempt failed
  // (the page itself is going to look broken in that case and the user
  // will figure it out without our help).
  let everSubscribed = false;
  const label = opts.label ?? "channel";

  const scheduleRetry = () => {
    if (cancelled) return;
    if (attemptsAfterFailure >= MAX_ATTEMPTS) {
      // We've exhausted the budget. Tell the user once.
      if (everSubscribed && !opts.silentOnGiveUp) {
        toastError("Connection lost. Try refreshing.");
      }
      // eslint-disable-next-line no-console
      console.warn(`[realtime-resilient] ${label}: gave up after ${MAX_ATTEMPTS} attempts`);
      return;
    }
    const delay = BACKOFF_MS[attemptsAfterFailure];
    attemptsAfterFailure += 1;
    pendingTimer = setTimeout(() => {
      if (cancelled) return;
      pendingTimer = null;
      // eslint-disable-next-line no-console
      console.log(`[realtime-resilient] ${label}: resubscribe attempt ${attemptsAfterFailure}/${MAX_ATTEMPTS}`);
      try {
        // Calling .subscribe() again on the same channel handle re-runs the
        // protocol; Supabase's client handles the second-call case idempotently
        // (it does NOT double-attach the broadcast listeners we registered
        // before the .subscribe() call).
        channel.subscribe(onStatus);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[realtime-resilient] ${label}: subscribe() threw`, err);
        scheduleRetry();
      }
    }, delay);
  };

  const onStatus = (status: string) => {
    if (cancelled) return;
    if (status === "SUBSCRIBED") {
      everSubscribed = true;
      attemptsAfterFailure = 0;
      opts.onSubscribed?.();
      return;
    }
    if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      opts.onUnsubscribed?.();
      // CLOSED on initial mount unmount is normal — we don't want to retry
      // a channel that the caller already wants gone. But our `cancelled`
      // check below ensures the wrapper goes quiet after .cancel() is called
      // (which the caller does in their cleanup before removeChannel).
      scheduleRetry();
    }
  };

  try {
    channel.subscribe(onStatus);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[realtime-resilient] ${label}: initial subscribe() threw`, err);
    scheduleRetry();
  }

  return {
    cancel: () => {
      cancelled = true;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    },
  };
}
