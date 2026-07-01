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
 * Honors `prefers-reduced-motion`: returns children in a plain static
 * `<div>` (no motion.div, no AnimatePresence, no animation) so
 * reduced-motion users get a pure synchronous swap. That wrapper `<div>`
 * is intentionally structurally identical to the animated branch — see
 * the hydration note on the fallback return below.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  // Defer the motion wrapper until after hydration. SSR can't know the
  // user's reduced-motion preference (useReducedMotion returns null
  // server-side) AND framer-motion's AnimatePresence + motion.div add
  // client-only internal structure — both conspire to produce a
  // server/client DOM mismatch on the very first paint. Returning a plain
  // <div> wrapper (structurally identical to the post-mount motion.div)
  // for the SSR pass + first client render keeps the trees identical; the
  // animated motion wrapper kicks in on the next render after useEffect
  // flips `mounted` to true.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Render a structurally-identical plain <div> wrapper for the SSR pass,
  // the first client render, AND reduced-motion users. The animated branch
  // below also renders exactly one wrapping <div> (framer's motion.div), so
  // the DOM shape is invariant across: initial hydration, the streamed RSC
  // segment that App Router reconciles on client-side navigation (e.g. into
  // /dashboard), and the post-mount swap to the animated wrapper. Returning
  // a bare fragment here instead made the wrapper appear/disappear between
  // the server-rendered route segment (always no wrapper) and the live
  // client tree (motion.div wrapper after mount) → "Did not expect server
  // HTML to contain a <div> in <div>" on navigation.
  if (!mounted || reduce) return <div>{children}</div>;

  // A perceptible per-route ENTER (fade + 8px rise) with an INSTANT exit. The
  // `transition` prop applies to the enter (0.26s, --ease-out-expo). The exit
  // gets its OWN duration:0 so `mode="wait"` doesn't stall the new page behind
  // an exit animation (that exit+enter stacking is exactly the perceived-delay
  // trap the old 80ms tuning was avoiding). Net: the new page slides up and
  // fades in over ~260ms while the old one leaves immediately. GPU-only
  // (transform + opacity), no layout shift; reduced-motion users hit the plain
  // <div> branch above and get a pure synchronous swap.
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 1, transition: { duration: 0 } }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        style={{ willChange: "transform, opacity" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
