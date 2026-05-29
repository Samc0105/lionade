"use client";

/**
 * AmbientOrbs — the shared "glow-orb" ambient background used across the
 * full-width hub pages (wallet, games, learning paths, …) to give a lonely
 * centered layout depth without a busy hero.
 *
 * Renders a few large, very-low-opacity radial gradients behind page content.
 * Purely decorative: `pointer-events-none`, `aria-hidden`, and GPU-cheap
 * (static radial gradients, no animation) so it's reduced-motion safe by
 * construction and never intercepts clicks.
 *
 * Pass `orbs` to key the colors to a page's accent palette. Defaults to a
 * cool electric + blue + violet set so every page shares one consistent
 * dark-interstellar background (no warm tints leaking in).
 */

export interface Orb {
  /** any CSS color — usually a hex like "#FFD700" */
  color: string;
  /** tailwind position utilities, e.g. "top-[15%] left-[20%]" */
  pos: string;
  /** pixel diameter */
  size: number;
  /** 0–1, kept intentionally tiny (0.03–0.06) so it reads as ambience */
  opacity: number;
}

const DEFAULT_ORBS: Orb[] = [
  { color: "#00BFFF", pos: "top-[12%] left-[16%]", size: 520, opacity: 0.05 },
  { color: "#4A90D9", pos: "bottom-[18%] right-[12%]", size: 440, opacity: 0.045 },
  { color: "#A855F7", pos: "top-[55%] left-[48%]", size: 600, opacity: 0.03 },
];

export default function AmbientOrbs({ orbs = DEFAULT_ORBS }: { orbs?: Orb[] }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none -z-0" aria-hidden="true">
      {orbs.map((o, i) => (
        <div
          key={i}
          className={`absolute rounded-full ${o.pos}`}
          style={{
            width: o.size,
            height: o.size,
            opacity: o.opacity,
            background: `radial-gradient(circle, ${o.color} 0%, transparent 70%)`,
          }}
        />
      ))}
    </div>
  );
}
