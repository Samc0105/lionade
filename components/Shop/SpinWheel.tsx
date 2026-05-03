"use client";

import { useEffect, useRef, useState } from "react";

/**
 * SpinWheel — animated SVG wheel.
 *
 * The wheel is purely presentational: it doesn't decide outcomes. The
 * server returns `landingIndex` (0..9), and this component animates
 * landing on that segment with a long deceleration so the user feels the
 * suspense.
 *
 * Slots are passed in (with colors + labels) so the parent component can
 * keep one source of truth from `lib/spin.ts` (mirrored client-side as a
 * COSMETIC list — no probabilities client-side).
 */

export interface WheelSlot {
  outcome: string;
  label: string;
  color: string;
}

export default function SpinWheel({
  slots,
  spinning,
  landingIndex,
  onLanded,
  size = 360,
}: {
  slots: WheelSlot[];
  spinning: boolean;
  landingIndex: number | null;  // null = idle
  onLanded?: () => void;
  size?: number;
}) {
  const segmentAngle = 360 / slots.length;
  const [rotation, setRotation] = useState(0);
  const animatingRef = useRef(false);

  useEffect(() => {
    if (!spinning || landingIndex == null || animatingRef.current) return;
    animatingRef.current = true;

    // Compute target rotation:
    //   - 6 full turns (suspense)
    //   - then land such that the chosen slot is at the top (12 o'clock)
    //   - subtract a tiny random jitter inside the segment so it never feels rigged
    const baseTurns = 6 * 360;
    // Slot 0 is at the top by default (we draw the wheel that way). So the
    // wheel must rotate so that slot `landingIndex` ends up at the top —
    // which means rotating by `-landingIndex * segmentAngle` (clockwise).
    // We go positive direction (clockwise = +) and add baseTurns.
    const jitter = (Math.random() - 0.5) * (segmentAngle * 0.6); // stay inside segment
    const target = baseTurns + (360 - landingIndex * segmentAngle) + jitter;

    setRotation(target);

    // Match the CSS transition duration. Clear the animating flag at the end.
    const t = setTimeout(() => {
      animatingRef.current = false;
      onLanded?.();
    }, 5200);
    return () => clearTimeout(t);
  }, [spinning, landingIndex, segmentAngle, onLanded]);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      {/* Outer glow ring */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow: "0 0 40px rgba(255, 215, 0, 0.18), inset 0 0 20px rgba(255,215,0,0.08)",
          background: "radial-gradient(circle, transparent 60%, rgba(255,215,0,0.06) 100%)",
        }}
      />

      {/* Pointer (pin at the top, 12 o'clock) */}
      <div
        className="absolute left-1/2 z-20"
        style={{
          top: -2,
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "12px solid transparent",
          borderRight: "12px solid transparent",
          borderTop: "20px solid #FFD700",
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
        }}
      />

      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning
            ? "transform 5s cubic-bezier(0.16, 1, 0.3, 1)"
            : "none",
          willChange: "transform",
        }}
      >
        {slots.map((slot, i) => {
          // Each segment spans `segmentAngle` degrees. Center of segment 0
          // is at the top (-90 deg in SVG coords, since 0 is east).
          const startA = -90 + i * segmentAngle - segmentAngle / 2;
          const endA = startA + segmentAngle;
          const startRad = (startA * Math.PI) / 180;
          const endRad = (endA * Math.PI) / 180;

          const x1 = cx + r * Math.cos(startRad);
          const y1 = cy + r * Math.sin(startRad);
          const x2 = cx + r * Math.cos(endRad);
          const y2 = cy + r * Math.sin(endRad);
          const largeArc = segmentAngle > 180 ? 1 : 0;

          const path = `
            M ${cx} ${cy}
            L ${x1} ${y1}
            A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}
            Z
          `;

          // Label center: midway along the radius of each segment.
          const labelA = -90 + i * segmentAngle;
          const labelRad = (labelA * Math.PI) / 180;
          // Push text further out so it has room to read along the radius.
          const lx = cx + r * 0.62 * Math.cos(labelRad);
          const ly = cy + r * 0.62 * Math.sin(labelRad);
          // Vertical labels: text reads ALONG the radius (center → edge),
          // like spokes on a wheel. The bottom-half segments would otherwise
          // be upside down — so for those we flip 180° so they stay readable.
          let labelRotation = labelA;
          const isBottomHalf = labelA > 0 && labelA < 180;
          if (isBottomHalf) labelRotation = labelA + 180;

          return (
            <g key={slot.outcome}>
              <path d={path} fill={slot.color} stroke="#0a1020" strokeWidth={2} />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={size / 28}
                fontWeight={700}
                fill="#0a1020"
                transform={`rotate(${labelRotation} ${lx} ${ly})`}
                style={{ pointerEvents: "none", letterSpacing: "0.04em" }}
              >
                {slot.label.toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* Center hub */}
        <circle cx={cx} cy={cy} r={size / 14} fill="#0a1020" stroke="#FFD700" strokeWidth={3} />
        <circle cx={cx} cy={cy} r={size / 28} fill="#FFD700" />
      </svg>
    </div>
  );
}
