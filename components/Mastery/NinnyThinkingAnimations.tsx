"use client";

import React from "react";

/**
 * Inline-SVG animation set for the "Ninny is thinking" indicator.
 *
 * All animations are CSS-keyframe driven (see globals.css `nt-*` rules) —
 * only transform / opacity / stroke-dashoffset move so they stay GPU-cheap.
 * `@media (prefers-reduced-motion: reduce)` in globals.css freezes every one
 * back to a static glyph.
 *
 * Each component takes a `size` (px square) and an optional `className` for
 * color overrides. Default color matches the existing Ninny purple (#A855F7).
 */

export type AnimationProps = {
  size?: number;
  className?: string;
  /** Override stroke / fill color. Defaults to the Ninny purple. */
  color?: string;
};

const DEFAULT_COLOR = "#A855F7";
const DEFAULT_SIZE = 20;

// ── 1. PulsingDots ──────────────────────────────────────────────────────────
export function PulsingDots({ size = DEFAULT_SIZE, className, color = DEFAULT_COLOR }: AnimationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="5"  cy="12" r="2.2" fill={color} className="nt-dot nt-dot-1" />
      <circle cx="12" cy="12" r="2.2" fill={color} className="nt-dot nt-dot-2" />
      <circle cx="19" cy="12" r="2.2" fill={color} className="nt-dot nt-dot-3" />
    </svg>
  );
}

// ── 2. ScribblingPen ────────────────────────────────────────────────────────
export function ScribblingPen({ size = DEFAULT_SIZE, className, color = DEFAULT_COLOR }: AnimationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Pen body */}
      <g className="nt-pen-body">
        <path
          d="M4 18 L14 8 L17 11 L7 21 Z"
          stroke={color}
          strokeWidth="1.6"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M14 8 L17 5 L20 8 L17 11"
          stroke={color}
          strokeWidth="1.6"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
      {/* Underline being drawn/erased */}
      <line
        x1="3" y1="22.5" x2="21" y2="22.5"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        className="nt-pen-line"
      />
    </svg>
  );
}

// ── 3. FlippingPages ────────────────────────────────────────────────────────
export function FlippingPages({ size = DEFAULT_SIZE, className, color = DEFAULT_COLOR }: AnimationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Bottom page (static) */}
      <rect x="4" y="6" width="16" height="14" rx="1.5"
        stroke={color}
        strokeWidth="1.4"
        fill={color}
        fillOpacity="0.08"
      />
      {/* Top page (flips) */}
      <rect
        x="4" y="6" width="16" height="14" rx="1.5"
        stroke={color}
        strokeWidth="1.4"
        fill={color}
        fillOpacity="0.2"
        className="nt-page-flip"
      />
      {/* Top page text lines */}
      <line x1="7" y1="10" x2="17" y2="10" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.55" />
      <line x1="7" y1="13" x2="14" y2="13" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

// ── 4. LightbulbSpark ───────────────────────────────────────────────────────
export function LightbulbSpark({ size = DEFAULT_SIZE, className, color = DEFAULT_COLOR }: AnimationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Bulb glass */}
      <g className="nt-bulb">
        <path
          d="M12 3.5 C 8.5 3.5 6.5 6 6.5 9 C 6.5 11 7.7 12.6 9.2 13.8 L 9.2 16 L 14.8 16 L 14.8 13.8 C 16.3 12.6 17.5 11 17.5 9 C 17.5 6 15.5 3.5 12 3.5 Z"
          stroke={color}
          strokeWidth="1.4"
          fill={color}
          fillOpacity="0.15"
          strokeLinejoin="round"
        />
        {/* Bulb base */}
        <line x1="9.5" y1="17.5" x2="14.5" y2="17.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        <line x1="10"  y1="19.5" x2="14"   y2="19.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      </g>
      {/* Sparks radiating */}
      <circle cx="3.5"  cy="9"  r="1" fill={color} className="nt-spark nt-spark-1" />
      <circle cx="20.5" cy="9"  r="1" fill={color} className="nt-spark nt-spark-2" />
      <circle cx="5"    cy="4"  r="1" fill={color} className="nt-spark nt-spark-3" />
      <circle cx="19"   cy="4"  r="1" fill={color} className="nt-spark nt-spark-4" />
    </svg>
  );
}

// ── 5. BrainScan ────────────────────────────────────────────────────────────
export function BrainScan({ size = DEFAULT_SIZE, className, color = DEFAULT_COLOR }: AnimationProps) {
  // clipPath keeps the scan line inside the brain silhouette.
  const clipId = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <path d="M8 4 C 5.5 4 4 6 4 8 C 4 9 4.3 9.8 4.8 10.4 C 4.3 11 4 11.8 4 12.8 C 4 14.8 5.5 16.5 7.5 17 L 7.5 19 C 7.5 20.1 8.4 21 9.5 21 L 14.5 21 C 15.6 21 16.5 20.1 16.5 19 L 16.5 17 C 18.5 16.5 20 14.8 20 12.8 C 20 11.8 19.7 11 19.2 10.4 C 19.7 9.8 20 9 20 8 C 20 6 18.5 4 16 4 C 14.8 4 13.8 4.5 13.2 5.3 C 12.8 5 12.4 4.9 12 4.9 C 11.6 4.9 11.2 5 10.8 5.3 C 10.2 4.5 9.2 4 8 4 Z" />
        </clipPath>
      </defs>
      {/* Brain outline */}
      <path
        d="M8 4 C 5.5 4 4 6 4 8 C 4 9 4.3 9.8 4.8 10.4 C 4.3 11 4 11.8 4 12.8 C 4 14.8 5.5 16.5 7.5 17 L 7.5 19 C 7.5 20.1 8.4 21 9.5 21 L 14.5 21 C 15.6 21 16.5 20.1 16.5 19 L 16.5 17 C 18.5 16.5 20 14.8 20 12.8 C 20 11.8 19.7 11 19.2 10.4 C 19.7 9.8 20 9 20 8 C 20 6 18.5 4 16 4 C 14.8 4 13.8 4.5 13.2 5.3 C 12.8 5 12.4 4.9 12 4.9 C 11.6 4.9 11.2 5 10.8 5.3 C 10.2 4.5 9.2 4 8 4 Z"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill={color}
        fillOpacity="0.08"
      />
      {/* Center fissure */}
      <line x1="12" y1="5" x2="12" y2="20" stroke={color} strokeWidth="1" opacity="0.5" />
      {/* Scan line — clipped to brain shape, travels with @keyframes nt-scan */}
      <g clipPath={`url(#${clipId})`}>
        <line
          x1="3" y1="12" x2="21" y2="12"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.9"
          className="nt-scan-line"
        />
      </g>
    </svg>
  );
}

// ── 6. CardShuffle ──────────────────────────────────────────────────────────
export function CardShuffle({ size = DEFAULT_SIZE, className, color = DEFAULT_COLOR }: AnimationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="5"  y="7" width="8" height="11" rx="1.4"
        stroke={color} strokeWidth="1.3"
        fill={color} fillOpacity="0.12"
        className="nt-card-1"
      />
      <rect x="8"  y="6" width="8" height="12" rx="1.4"
        stroke={color} strokeWidth="1.3"
        fill={color} fillOpacity="0.18"
        className="nt-card-2"
      />
      <rect x="11" y="7" width="8" height="11" rx="1.4"
        stroke={color} strokeWidth="1.3"
        fill={color} fillOpacity="0.12"
        className="nt-card-3"
      />
    </svg>
  );
}

// ── 7. QuestionMarkDance ────────────────────────────────────────────────────
export function QuestionMarkDance({ size = DEFAULT_SIZE, className, color = DEFAULT_COLOR }: AnimationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <text
        x="12" y="17"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="700"
        fontSize="17"
        fill={color}
        className="nt-qmark"
      >
        ?
      </text>
    </svg>
  );
}

// ── Registry + picker ──────────────────────────────────────────────────────
export const THINKING_ANIMATIONS: ReadonlyArray<React.ComponentType<AnimationProps>> = [
  PulsingDots,
  ScribblingPen,
  FlippingPages,
  LightbulbSpark,
  BrainScan,
  CardShuffle,
  QuestionMarkDance,
];

/**
 * Pick a random thinking animation. Accept an optional seed for deterministic
 * selection in tests. Without a seed the picker uses Math.random.
 */
export function pickThinkingAnimation(seed?: number): React.ComponentType<AnimationProps> {
  const idx = typeof seed === "number"
    ? Math.abs(Math.floor(seed)) % THINKING_ANIMATIONS.length
    : Math.floor(Math.random() * THINKING_ANIMATIONS.length);
  return THINKING_ANIMATIONS[idx] ?? PulsingDots;
}
