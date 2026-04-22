"use client";

import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  value: number;
  duration?: number;
  delay?: number;
  format?: (n: number) => string;
  className?: string;
}

const defaultFormat = (n: number) => n.toLocaleString();

/**
 * Animated number counter. Counts from previous visible value -> new value
 * over `duration` ms using ease-out-cubic (matches `useCountUp` in
 * app/quiz/page.tsx for consistency).
 *
 * Accessibility:
 *   - Respects `prefers-reduced-motion` — snaps to target instantly.
 *   - The animating number is `aria-hidden="true"` so screen readers don't get
 *     spammed with every intermediate integer. A visually-hidden sibling
 *     carries the target value in an `aria-live="polite"` region so the final
 *     number is still announced.
 */
export default function CountUp({
  value,
  duration = 600,
  delay = 0,
  format = defaultFormat,
  className,
}: CountUpProps) {
  const [current, setCurrent] = useState<number>(0);
  // previousRef tracks the animation start value; currentRef tracks the
  // most recently RENDERED value so that if `value` changes mid-animation the
  // next run starts smoothly from where the user can see, not from the stale
  // pre-animation starting point.
  const previousRef = useRef<number>(0);
  const currentRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    // Cancel any in-flight animation and pick up from wherever we are visually
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const start = currentRef.current;
    const end = value;

    if (start === end) {
      previousRef.current = end;
      return;
    }

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setCurrent(end);
      currentRef.current = end;
      previousRef.current = end;
      return;
    }

    previousRef.current = start;

    const run = () => {
      const startTime = performance.now();
      const delta = end - start;

      const tick = (now: number) => {
        if (!mountedRef.current) return;
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const next = Math.round(start + delta * eased);
        currentRef.current = next;
        setCurrent(next);
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
          previousRef.current = end;
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    };

    if (delay > 0) {
      timeoutRef.current = setTimeout(run, delay);
    } else {
      run();
    }
  }, [value, duration, delay]);

  return (
    <>
      <span className={className} aria-hidden="true">
        {format(current)}
      </span>
      <span className="sr-only" aria-live="polite">
        {format(value)}
      </span>
    </>
  );
}
