"use client";

/**
 * FluidReveal — opacity + slide-up reveal driven by IntersectionObserver.
 *
 * Wraps any child. When the wrapper crosses 20% into the viewport, the
 * `.is-visible` class is toggled, which triggers the CSS transition defined
 * by `.fluid-reveal` in app/globals.css.
 *
 * Design rules:
 *   - GPU-only (opacity + transform).
 *   - prefers-reduced-motion: short-circuits to visible on mount, no observer.
 *   - SSR-safe: starts in the "pre-reveal" state on the server, then mounts
 *     the observer client-side. If JS doesn't load, content still reads —
 *     the .fluid-reveal class has opacity: 0 BUT FluidReveal renders without
 *     the class on the initial server render to avoid invisible-on-no-JS.
 *     The class is applied via useEffect once the observer is wired.
 *   - Fires ONCE per element per page load (`once: true` semantics).
 *
 * Usage:
 *   <FluidReveal>
 *     <section>...content...</section>
 *   </FluidReveal>
 *
 *   <FluidReveal delay={80}>
 *     <SecondSection />
 *   </FluidReveal>
 */

import { useEffect, useRef, useState } from "react";

type FluidRevealProps = {
  children: React.ReactNode;
  /** Stagger offset in ms — applied as transitionDelay once visible. */
  delay?: number;
  /** % of element that must be in-viewport before triggering. Default 0.2. */
  threshold?: number;
  /** Optional className on the wrapper div (in addition to .fluid-reveal). */
  className?: string;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function FluidReveal({
  children,
  delay = 0,
  threshold = 0.2,
  className = "",
}: FluidRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Start NOT armed — i.e. don't apply the `.fluid-reveal` opacity-0 class
  // on the server render. Once mounted client-side, we arm it (if motion is
  // allowed) then the observer flips `is-visible`.
  const [armed, setArmed] = useState<boolean>(false);
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      // Reduced-motion: skip the animation. Don't arm.
      setArmed(false);
      setVisible(true);
      return;
    }

    // Older browsers without IntersectionObserver — bail to instant-visible.
    if (typeof IntersectionObserver === "undefined") {
      setArmed(false);
      setVisible(true);
      return;
    }

    setArmed(true);

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold, rootMargin: "0px 0px -10% 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  const cls = [
    armed ? "fluid-reveal" : "",
    armed && visible ? "is-visible" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={cls}
      style={delay > 0 && armed ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
