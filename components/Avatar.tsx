"use client";

/**
 * Avatar — Shop V2 cosmetic avatar wrapper (2026-06-09)
 *
 * Renders a user avatar with an optional equipped FRAME (colored ring) and/or
 * AURA (outer glow halo). Three DOM layers, stacked with absolute positioning
 * so there is ZERO layout shift regardless of whether cosmetics are present:
 *
 *   1. aura span  (behind the image — radial glow halo, blurred)
 *   2. <img>      (the verbatim avatar URL — never re-keyed / regenerated)
 *   3. frame span (on top — colored ring via box-shadow, pointer-events: none)
 *
 * Avatar-stability rule (docs/CLAUDE_AGENT.md): the <img src> is the EXACT url
 * passed in. We never append cache-busters, never key={Date.now()}, never
 * regenerate it. The caller owns memoizing the url.
 *
 * Degradation: when both frame and aura resolve to null the overlay spans are
 * inert (empty, no class, no glow) so a plain avatar shows with no flash.
 *
 * Performance: at xs / sm sizes the frame + aura render their STATIC ring only
 * (animation classes are dropped) so a list of many avatars does not spawn many
 * animating halos. md / lg / xl honor the animated class. All animations are
 * GPU-only (transform / opacity / filter) and reduced-motion safe in globals.css.
 */

import { useMemo } from "react";
import {
  getFrameStyle,
  getAuraStyle,
} from "@/lib/cosmetics/cosmetic-styles";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface AvatarProps {
  /** The verbatim avatar URL. Passed straight to <img src>. */
  url: string | null | undefined;
  alt: string;
  size?: AvatarSize;
  /** Equipped frame cosmetic id (or null / "none"). */
  frame?: string | null;
  /** Equipped aura cosmetic id (or null / "none"). */
  aura?: string | null;
  /** Extra classes on the outer wrapper (positioning, margins, etc.). */
  className?: string;
}

// Pixel sizes per spec: xs36 / sm32 / md48 / lg80 / xl112.
const SIZE_PX: Record<AvatarSize, number> = {
  xs: 36,
  sm: 32,
  md: 48,
  lg: 80,
  xl: 112,
};

// Ring thickness scales with size — keeps the ring proportional.
const RING_PX: Record<AvatarSize, number> = {
  xs: 2,
  sm: 2,
  md: 2.5,
  lg: 3.5,
  xl: 4,
};

// At these sizes we drop the animation to avoid many animating halos in lists.
const STATIC_SIZES: AvatarSize[] = ["xs", "sm"];

export default function Avatar({
  url,
  alt,
  size = "md",
  frame,
  aura,
  className = "",
}: AvatarProps) {
  const px = SIZE_PX[size];
  const ringPx = RING_PX[size];
  const isStatic = STATIC_SIZES.includes(size);

  const frameStyle = useMemo(() => getFrameStyle(frame), [frame]);
  const auraStyle = useMemo(() => getAuraStyle(aura), [aura]);

  // Frame ring: layered box-shadow rings (no layout impact). Optional second
  // ring color creates a two-tone look; a soft glow ring sits outside.
  const frameBoxShadow = frameStyle
    ? [
        `0 0 0 ${ringPx}px ${frameStyle.ring}`,
        frameStyle.ring2 ? `0 0 0 ${ringPx * 2}px ${frameStyle.ring2}` : "",
        frameStyle.glow ? `0 0 ${ringPx * 4}px ${frameStyle.glow}` : "",
      ]
        .filter(Boolean)
        .join(", ")
    : undefined;

  const frameAnim = frameStyle && !isStatic ? frameStyle.animClass : undefined;
  const auraAnim = auraStyle && !isStatic ? auraStyle.animClass : undefined;

  // Halo radius extends beyond the avatar; absolute + negative inset keeps it
  // centered behind the image without affecting layout.
  const haloInset = -Math.round(px * 0.35);

  return (
    <span
      className={`relative inline-block flex-shrink-0 ${className}`}
      style={{ width: px, height: px }}
    >
      {/* Layer 1 — aura halo (behind). Inert empty span when no aura. */}
      <span
        aria-hidden="true"
        className={`absolute rounded-full pointer-events-none ${auraAnim ?? ""}`}
        style={
          auraStyle
            ? {
                top: haloInset,
                left: haloInset,
                right: haloInset,
                bottom: haloInset,
                background: auraStyle.color2
                  ? `radial-gradient(circle, ${auraStyle.color} 0%, ${auraStyle.color2} 45%, transparent 70%)`
                  : `radial-gradient(circle, ${auraStyle.color} 0%, transparent 70%)`,
                filter: "blur(6px)",
                zIndex: 0,
              }
            : { display: "none" }
        }
      />

      {/* Layer 2 — the verbatim avatar image (never re-keyed). */}
      <img
        src={url ?? undefined}
        alt={alt}
        className="absolute inset-0 w-full h-full rounded-full object-cover"
        style={{ zIndex: 1 }}
      />

      {/* Layer 3 — frame ring (on top, box-shadow only). Inert when no frame. */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full pointer-events-none ${frameAnim ?? ""}`}
        style={
          frameStyle
            ? { boxShadow: frameBoxShadow, zIndex: 2 }
            : { display: "none" }
        }
      />
    </span>
  );
}
