"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

/**
 * Subtle route-change fade for the main content area.
 *
 * Wraps `<main>{children}</main>` only — Navbar, Footer, and floating
 * components stay mounted across navigations. Animation is opacity-only
 * with a tiny 8px Y rise; no layout shift, no scroll jank.
 *
 * `mode="wait"` is used (not "popLayout") so the outgoing page fully
 * unmounts before the new one mounts. With a 180ms exit, the perceived
 * delay is unnoticeable, and "wait" avoids the brief content overlap that
 * "popLayout" causes when both pages occupy the same scroll container —
 * which on Lionade would flash two stacked dashboards for a frame.
 *
 * Honors `prefers-reduced-motion`: returns children with no wrapper at
 * all (no motion.div, no AnimatePresence) so reduced-motion users get a
 * pure synchronous swap.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  // Defer the motion wrapper until after hydration. SSR can't know the
  // user's reduced-motion preference (useReducedMotion returns null
  // server-side) AND framer-motion's AnimatePresence + motion.div add
  // client-only internal structure — both conspire to produce a
  // server/client DOM mismatch on the very first paint. Returning bare
  // children for the SSR pass + first client render keeps the trees
  // identical; the motion wrapper kicks in on the next render after
  // useEffect flips `mounted` to true.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted || reduce) return <>{children}</>;

  // Tuned tight: 80ms enter, 0ms exit (mode="sync" so the new page mounts
  // immediately while the old one is still fading is intentionally avoided —
  // we just skip the exit animation so navigation feels instant). 180ms
  // exit + 180ms enter = 360ms perceived delay; this is ~80ms.
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 1 }}
        transition={{ duration: 0.08, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
