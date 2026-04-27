"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks whether a UI element should be in its "attentioned" (full-color,
 * focused) state vs its "drifted" (dimmed, blurred, low-priority) state.
 *
 *   - Default state: drifted.
 *   - `wake()` snaps to attentioned and cancels any pending drift timer.
 *   - `drift()` schedules a drift after `idleMs` of no further wake calls.
 *
 * Wire to a button via { onMouseEnter: wake, onMouseLeave: drift,
 * onFocus: wake, onBlur: drift }, then style with the `attentioned` flag.
 *
 * Default 10s feels right for floating corner buttons — long enough that
 * a quick mouse pass doesn't immediately re-fade, short enough that the
 * dim resting state actually gets to do its job.
 */
export function useIdleAttention(idleMs = 10000) {
  const [attentioned, setAttentioned] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const wake = () => {
    clear();
    setAttentioned(true);
  };

  const drift = () => {
    clear();
    timerRef.current = setTimeout(() => {
      setAttentioned(false);
      timerRef.current = null;
    }, idleMs);
  };

  useEffect(() => () => clear(), []);

  return {
    attentioned,
    wake,
    drift,
    /** Convenience prop bag for spreadable attachment. */
    bind: {
      onMouseEnter: wake,
      onMouseLeave: drift,
      onFocus: wake,
      onBlur: drift,
    },
  };
}
