"use client";

import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  value: number;
  duration?: number;
  delay?: number;
  format?: (n: number) => string;
  className?: string;
  /**
   * Optional cache key. When provided, the last rendered value for this id
   * is kept in a module-level map AND sessionStorage, so navigating between
   * pages (which remounts the component) starts the next animation from
   * where it left off — instead of resetting to 0 and counting back up.
   *
   * Use one id per logical number (e.g. "user-coins", "user-xp") and reuse
   * it everywhere that number is rendered.
   */
  id?: string;
}

const defaultFormat = (n: number) => n.toLocaleString();

// ─────────────────────────────────────────────────────────────────────────────
// Cross-mount value cache
// ─────────────────────────────────────────────────────────────────────────────
// Module-level Map persists across remounts within the same app session;
// sessionStorage hydrates the map on first import so a hard reload of a
// signed-in user still sees their last-rendered numbers without a 0-flash.
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_KEY = "lionade_countup_cache_v1";
const valueCache: Map<string, number> = (() => {
  const map = new Map<string, number>();
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "number" && Number.isFinite(v)) map.set(k, v);
        }
      }
    } catch { /* ignore */ }
  }
  return map;
})();

function persistCache() {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, number> = {};
    valueCache.forEach((v, k) => { obj[k] = v; });
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj));
  } catch { /* storage quota / private mode */ }
}

/**
 * Animated number counter. Counts from previous visible value -> new value
 * over `duration` ms using ease-out-cubic.
 *
 * Pass an `id` to make it remember its last value across remounts (page
 * navigations) — so the navbar coin counter doesn't drop to 0 every time
 * the user clicks a tab.
 *
 * Accessibility:
 *   - Respects `prefers-reduced-motion` — snaps to target instantly.
 *   - The animating number is `aria-hidden="true"` so screen readers don't
 *     get spammed with every intermediate integer. A visually-hidden
 *     sibling carries the target value in an `aria-live="polite"` region
 *     so the final number is still announced.
 */
export default function CountUp({
  value,
  duration = 600,
  delay = 0,
  format = defaultFormat,
  className,
  id,
}: CountUpProps) {
  // Hydrate from cache so the first render shows the last-seen value, not 0.
  const cachedStart = id !== undefined ? valueCache.get(id) : undefined;
  const initialValue = cachedStart ?? value ?? 0;

  const [current, setCurrent] = useState<number>(initialValue);
  // previousRef tracks the animation start value; currentRef tracks the
  // most recently RENDERED value so that if `value` changes mid-animation
  // the next run starts smoothly from where the user can see, not from
  // the stale pre-animation starting point.
  const previousRef = useRef<number>(initialValue);
  const currentRef = useRef<number>(initialValue);
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
    // Cancel any in-flight animation and pick up from wherever we are visually.
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
      if (id !== undefined) {
        valueCache.set(id, end);
        persistCache();
      }
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
      if (id !== undefined) {
        valueCache.set(id, end);
        persistCache();
      }
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
          if (id !== undefined) {
            valueCache.set(id, end);
            persistCache();
          }
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    };

    if (delay > 0) {
      timeoutRef.current = setTimeout(run, delay);
    } else {
      run();
    }
  }, [value, duration, delay, id]);

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
