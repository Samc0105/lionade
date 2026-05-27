"use client";

// Arena V2 — HP bar.
//
// Central state replaces V1's parallel score. Two HP bars at the top of the
// battle screen — yours on the left, opponent's on the right.
//
// Color thresholds match the EmojiReaction component:
//   100-70 = healthy gold
//   69-40  = warning amber
//   39-15  = danger red
//   <15    = critical pulsing red
//
// Damage animation = spring-decay on the bar fill width via framer-motion,
// with a 1-frame numeric flash (the damage amount, e.g. "-15") that fades
// out. Respects prefers-reduced-motion.

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

interface HpBarProps {
  /** Current HP, 0-100. */
  hp: number;
  /** Display name above the bar. */
  label: string;
  /** Right-align the fill (opponent side). Default false. */
  reverse?: boolean;
  /** Optional "TRAINER" / "LIVE" / "MISMATCH" badge below the label. */
  badge?: string;
  /** Optional pulse on damage. Set whenever damage was just applied. */
  flashKey?: number;
}

export default function HpBar({ hp, label, reverse = false, badge, flashKey }: HpBarProps) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, hp));

  // Animate the damage-flash number when flashKey changes.
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (flashKey === undefined) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 600);
    return () => clearTimeout(t);
  }, [flashKey]);

  // Color zone.
  const zone =
    clamped > 70 ? "healthy" :
    clamped > 39 ? "warning" :
    clamped > 14 ? "danger" : "critical";

  const colors = {
    healthy:  { fill: "linear-gradient(90deg, #FFD700 0%, #FFA500 100%)", glow: "rgba(255,215,0,0.25)", text: "#FFD700" },
    warning:  { fill: "linear-gradient(90deg, #FFA500 0%, #FF6B35 100%)", glow: "rgba(255,165,0,0.25)", text: "#FFA500" },
    danger:   { fill: "linear-gradient(90deg, #FF6B35 0%, #EF4444 100%)", glow: "rgba(239,68,68,0.3)",  text: "#EF4444" },
    critical: { fill: "linear-gradient(90deg, #EF4444 0%, #DC2626 100%)", glow: "rgba(220,38,38,0.45)", text: "#EF4444" },
  }[zone];

  return (
    <div className={`flex flex-col ${reverse ? "items-end" : "items-start"} gap-1.5 w-full`}>
      <div className={`flex items-baseline gap-2 ${reverse ? "flex-row-reverse" : ""}`}>
        <span className="font-syne font-bold text-sm sm:text-base text-cream truncate max-w-[150px]">{label}</span>
        {badge && (
          <span
            className="font-bebas text-[10px] tracking-[0.15em] px-1.5 py-0.5 rounded"
            style={{
              background: "rgba(184,150,12,0.15)",
              border: "1px solid rgba(255,215,0,0.35)",
              color: "#FFD700",
            }}
          >
            {badge}
          </span>
        )}
      </div>

      <div className="relative w-full h-5 sm:h-6 rounded-full overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: `inset 0 1px 2px rgba(0,0,0,0.4)`,
        }}>
        <motion.div
          aria-label={`${label} HP ${clamped} of 100`}
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          className="absolute top-0 bottom-0"
          style={{
            background: colors.fill,
            boxShadow: `0 0 18px ${colors.glow}`,
            left: reverse ? "auto" : 0,
            right: reverse ? 0 : "auto",
            borderRadius: 999,
          }}
          initial={false}
          animate={{
            width: `${clamped}%`,
            opacity: zone === "critical" && !reduced ? [1, 0.7, 1] : 1,
          }}
          transition={
            reduced
              ? { duration: 0 }
              : {
                  width: { type: "spring", stiffness: 220, damping: 22, mass: 0.7 },
                  opacity: zone === "critical" ? { duration: 0.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0 },
                }
          }
        />
        {flashing && !reduced && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.35, 0] }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 pointer-events-none"
            style={{ background: "rgba(255,255,255,0.6)" }}
            aria-hidden="true"
          />
        )}
      </div>

      <div className={`flex items-baseline gap-1.5 ${reverse ? "flex-row-reverse" : ""}`}>
        <span
          className="font-bebas text-lg sm:text-xl tracking-wider"
          style={{ color: colors.text }}
          aria-label={`${clamped} HP`}
        >
          {clamped}
        </span>
      </div>
    </div>
  );
}
