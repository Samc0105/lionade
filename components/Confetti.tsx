"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

interface ConfettiProps {
  /** Set to true to fire. On false→true transition, particles emit. */
  trigger: boolean;
  /** Number of particles. Default 40. */
  count?: number;
  /**
   * "center" = burst outward from viewport center.
   * "top"    = rain down from across the top edge.
   */
  origin?: "center" | "top";
  /** Color palette — one is picked per particle. */
  palette?: string[];
  /** Total animation length in ms. Default 1400. */
  duration?: number;
  /** Called once the last particle (including its delay) finishes. */
  onComplete?: () => void;
}

const DEFAULT_PALETTE = ["#FFD700", "#F0B429", "#4A90D9", "#22C55E", "#EF4444"];
const MAX_DELAY_MS = 200;

interface Particle {
  id: number;
  left: string;
  top: string;
  width: number;
  height: number;
  color: string;
  dx: number;
  dy: number;
  rot: number;
  delay: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function buildParticles(count: number, origin: "center" | "top", palette: string[]): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const color = palette[Math.floor(Math.random() * palette.length)] ?? DEFAULT_PALETTE[0];
    const width = 6 + Math.random() * 4; // 6-10
    const height = 8 + Math.random() * 6; // 8-14
    const rot = Math.random() * 360;
    const delay = Math.random() * MAX_DELAY_MS;

    if (origin === "top") {
      return {
        id: i,
        left: `${Math.random() * 100}%`,
        top: "-20px",
        width,
        height,
        color,
        dx: Math.random() * 400 - 200, // -200 to 200
        dy: 200 + Math.random() * 200, // 200 to 400
        rot,
        delay,
      };
    }

    // center
    return {
      id: i,
      left: "50%",
      top: "50%",
      width,
      height,
      color,
      dx: Math.random() * 400 - 200, // -200 to 200
      dy: -300 - Math.random() * 200, // -300 to -500
      rot,
      delay,
    };
  });
}

export default function Confetti({
  trigger,
  count = 40,
  origin = "center",
  palette = DEFAULT_PALETTE,
  duration = 1400,
  onComplete,
}: ConfettiProps) {
  const [burst, setBurst] = useState<{ key: number; particles: Particle[] } | null>(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    if (!trigger) return;
    if (reduced) {
      // Skip render; still fire onComplete so consumers can clear their flag.
      onComplete?.();
      return;
    }

    const particles = buildParticles(count, origin, palette);
    const key = Date.now();
    setBurst({ key, particles });

    const timer = setTimeout(() => {
      setBurst((current) => (current && current.key === key ? null : current));
      onComplete?.();
    }, duration + MAX_DELAY_MS);

    return () => clearTimeout(timer);
    // Fire on leading edge only — deps intentionally narrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  if (!burst || reduced) return null;

  const animationName = origin === "top" ? "confetti-rain" : "confetti-burst";

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]" aria-hidden="true">
      {burst.particles.map((p) => {
        const style: CSSProperties & Record<string, string | number> = {
          position: "absolute",
          left: p.left,
          top: p.top,
          width: `${p.width}px`,
          height: `${p.height}px`,
          backgroundColor: p.color,
          willChange: "transform, opacity",
          animationName,
          animationDuration: `${duration}ms`,
          animationTimingFunction: "var(--ease-out-quart)",
          animationFillMode: "forwards",
          animationDelay: `${p.delay}ms`,
          "--dx": `${p.dx}px`,
          "--dy": `${p.dy}px`,
          "--rot": `${p.rot + 360}deg`,
        };
        return <div key={p.id} className="confetti-particle" style={style} />;
      })}
    </div>
  );
}
