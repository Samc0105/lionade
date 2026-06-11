"use client";

// Competitive Arena — pre-round 3-2-1-GO countdown overlay.
//
// Purely presentational + self-contained. Renders a full-surface (NOT
// full-viewport-flash) dim scrim with a large ticking number that scales down
// and fades on each beat (.ca-count-tick keyframe in globals.css). After the
// final "GO!" tick it calls onDone() and unmounts. Respects reduced motion:
// when motion is reduced we skip the number theatre — but we STILL wait until
// the anchor instant before firing onDone() (so both players start together).
//
// SERVER-ANCHORED MODE (migration 059): when `startsAt` (an ISO timestamp) is
// provided, the countdown is anchored to that single server instant instead of
// each client's own mount time. Both clients show 3/2/1/GO based on the time
// REMAINING until startsAt, and call onDone() exactly when the anchor is
// reached (immediately if already past). This kills the clock-skew head start:
// the two players hit "GO!" at the same wall-clock instant (modulo each
// device's own sub-second NTP skew).
//
// FALLBACK: when `startsAt` is null/absent (e.g. a pre-migration match row),
// the component falls back to its original purely-local 800ms beat sequence, so
// nothing breaks before the migration is applied.

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

const SEQUENCE = ["3", "2", "1", "GO!"];
const BEAT_MS = 800;
// Anchored buckets: the sequence is 4 beats of BEAT_MS each, counting DOWN to
// the anchor. >2400ms left -> "3", >1600 -> "2", >800 -> "1", >0 -> "GO!".
const ANCHORED_WINDOW_MS = SEQUENCE.length * BEAT_MS; // 3200ms

/** Map ms-remaining-until-anchor to a SEQUENCE index. -1 means "done". */
function bucketFor(msRemaining: number): number {
  if (msRemaining <= 0) return -1;
  if (msRemaining > 2400) return 0; // "3"
  if (msRemaining > 1600) return 1; // "2"
  if (msRemaining > 800) return 2; // "1"
  return 3; // "GO!"
}

export default function Countdown({
  accent,
  onDone,
  startsAt = null,
}: {
  accent: string;
  onDone: () => void;
  startsAt?: string | null;
}) {
  const reduce = useReducedMotion();

  // Keep the latest onDone in a ref so the timer effects can depend ONLY on the
  // anchor/step, not on the identity of onDone. Parents tick frequently (e.g.
  // Sabotage's 100ms clock) and pass a fresh onDone each render; without this
  // the timers would reset on every parent render and never advance.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneFiredRef = useRef(false);

  const anchorMs = startsAt ? new Date(startsAt).getTime() : null;
  const useAnchor = anchorMs !== null && !Number.isNaN(anchorMs);

  // ── Anchored mode: drive the visible number from time-remaining-until-anchor.
  // Tick at 100ms for a crisp hand-off; both clients converge on the same wall
  // clock. Fires onDone() exactly once, the moment the anchor is reached.
  const [anchorStep, setAnchorStep] = useState(() =>
    useAnchor ? bucketFor((anchorMs as number) - Date.now()) : 0,
  );

  useEffect(() => {
    if (!useAnchor) return;
    const fireDone = () => {
      if (doneFiredRef.current) return;
      doneFiredRef.current = true;
      onDoneRef.current();
    };
    const tick = () => {
      const remaining = (anchorMs as number) - Date.now();
      if (remaining <= 0) {
        setAnchorStep(-1);
        fireDone();
        return true; // reached the anchor
      }
      // Under reduced motion we skip the number theatre but still HONOR the
      // anchor: keep the (hidden) scrim and wait out the remaining time.
      if (!reduce) setAnchorStep(bucketFor(remaining));
      return false;
    };
    if (tick()) return; // already past the anchor — done immediately
    const iv = setInterval(() => {
      if (tick()) clearInterval(iv);
    }, 100);
    return () => clearInterval(iv);
  }, [useAnchor, anchorMs, reduce]);

  // ── Fallback (no anchor): original purely-local 800ms beat sequence. ──
  const [localStep, setLocalStep] = useState(0);
  useEffect(() => {
    if (useAnchor) return;
    if (reduce) {
      const id = requestAnimationFrame(() => {
        if (!doneFiredRef.current) {
          doneFiredRef.current = true;
          onDoneRef.current();
        }
      });
      return () => cancelAnimationFrame(id);
    }
    if (localStep >= SEQUENCE.length) {
      if (!doneFiredRef.current) {
        doneFiredRef.current = true;
        onDoneRef.current();
      }
      return;
    }
    const t = setTimeout(() => setLocalStep((s) => s + 1), BEAT_MS);
    return () => clearTimeout(t);
  }, [useAnchor, localStep, reduce]);

  const step = useAnchor ? anchorStep : localStep;

  // Under reduced motion (either mode) we never paint the numbers. In anchored
  // mode the effect above still waits out the anchor before onDone(); in local
  // mode onDone() already fired on the next frame.
  if (reduce) return null;
  if (step < 0 || step >= SEQUENCE.length) return null;

  const label = SEQUENCE[step];
  const isGo = label === "GO!";

  return (
    <div
      className="absolute inset-0 z-[40] flex items-center justify-center pointer-events-none"
      style={{ background: "rgba(4,6,13,0.55)" }}
      aria-hidden="true"
    >
      <span
        key={step}
        className="ca-count-tick font-bebas leading-none"
        style={{
          fontSize: isGo ? "clamp(4rem, 18vw, 11rem)" : "clamp(5rem, 22vw, 14rem)",
          color: isGo ? accent : "var(--cream, #f5e9d0)",
          textShadow: `0 0 40px ${accent}66`,
        }}
      >
        {label}
      </span>
    </div>
  );
}
