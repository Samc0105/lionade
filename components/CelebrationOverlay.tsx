"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { X, Coin } from "@phosphor-icons/react";
import RevealText from "@/components/RevealText";

const Confetti = dynamic(() => import("@/components/Confetti"), { ssr: false });

export interface Celebration {
  id: string;
  eyebrow: string;
  headline: string;
  description?: string;
  illustration?: string;
  fangs?: number;
  accent?: "gold" | "ember" | "electric";
}

interface CelebrationOverlayProps {
  celebrations: Celebration[];
  autoDismissMs?: number;
  onAllDismissed?: () => void;
}

const ACCENTS: Record<NonNullable<Celebration["accent"]>, {
  ring: string;
  glow: string;
  headline: string;
  gradient: string;
  particles: string[];
}> = {
  gold: {
    ring: "rgba(255,215,0,0.55)",
    glow: "0 0 80px rgba(255,215,0,0.25), 0 0 160px rgba(74,144,217,0.18)",
    headline: "#FFD700",
    gradient: "linear-gradient(135deg, rgba(255,215,0,0.16) 0%, rgba(74,144,217,0.10) 50%, rgba(124,58,237,0.08) 100%)",
    particles: ["#FFD700", "#F0B429", "#4A90D9", "#7C3AED", "#EEF4FF"],
  },
  ember: {
    ring: "rgba(249,115,22,0.55)",
    glow: "0 0 80px rgba(249,115,22,0.28), 0 0 160px rgba(255,215,0,0.16)",
    headline: "#FFB347",
    gradient: "linear-gradient(135deg, rgba(249,115,22,0.18) 0%, rgba(255,215,0,0.10) 50%, rgba(124,58,237,0.06) 100%)",
    particles: ["#F97316", "#FFB347", "#FFD700", "#EF4444", "#EEF4FF"],
  },
  electric: {
    ring: "rgba(74,144,217,0.55)",
    glow: "0 0 80px rgba(74,144,217,0.28), 0 0 160px rgba(124,58,237,0.18)",
    headline: "#7BB7F0",
    gradient: "linear-gradient(135deg, rgba(74,144,217,0.18) 0%, rgba(124,58,237,0.10) 50%, rgba(255,215,0,0.08) 100%)",
    particles: ["#4A90D9", "#7BB7F0", "#7C3AED", "#FFD700", "#EEF4FF"],
  },
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function CelebrationOverlay({
  celebrations,
  autoDismissMs = 5200,
  onAllDismissed,
}: CelebrationOverlayProps) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const current = celebrations[index] ?? null;
  const isDone = !current;

  useEffect(() => {
    if (!current) return;
    setVisible(true);
    setConfettiKey((k) => k + 1);
    const t = setTimeout(() => setVisible(false), autoDismissMs);
    return () => clearTimeout(t);
  }, [current, autoDismissMs]);

  useEffect(() => {
    if (visible || isDone) return;
    const t = setTimeout(() => {
      if (index + 1 >= celebrations.length) {
        onAllDismissed?.();
      } else {
        setIndex((i) => i + 1);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [visible, isDone, index, celebrations.length, onAllDismissed]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setVisible(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  useEffect(() => {
    if (visible) {
      const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [visible]);

  if (isDone) return null;
  if (!current) return null;

  const accent = ACCENTS[current.accent ?? "gold"];

  return (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center p-4 transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      style={{
        background: "radial-gradient(ellipse at center, rgba(4,8,15,0.72) 0%, rgba(4,8,15,0.92) 100%)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${current.eyebrow}: ${current.headline}`}
      onClick={() => setVisible(false)}
    >
      <Confetti
        key={confettiKey}
        trigger={visible && !reduced}
        count={current.accent === "ember" ? 70 : 60}
        duration={1800}
        palette={accent.particles}
        origin="center"
      />

      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-md rounded-[28px] border overflow-hidden ${
          visible ? "celebration-card-enter" : "celebration-card-exit"
        }`}
        style={{
          background:
            "linear-gradient(135deg, rgba(10,16,32,0.96) 0%, rgba(6,12,24,0.96) 100%)",
          borderColor: accent.ring,
          boxShadow: accent.glow,
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: accent.gradient }}
          aria-hidden="true"
        />

        {!reduced && (
          <div
            className="absolute -top-24 -left-24 w-64 h-64 rounded-full pointer-events-none celebration-orb-a"
            style={{ background: `radial-gradient(circle, ${accent.headline}33 0%, transparent 70%)` }}
            aria-hidden="true"
          />
        )}
        {!reduced && (
          <div
            className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full pointer-events-none celebration-orb-b"
            style={{ background: `radial-gradient(circle, ${accent.headline}22 0%, transparent 70%)` }}
            aria-hidden="true"
          />
        )}

        <button
          ref={closeBtnRef}
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full grid place-items-center text-cream/55 hover:text-cream hover:bg-white/[0.08] transition-colors"
        >
          <X size={14} weight="bold" aria-hidden="true" />
        </button>

        <div className="relative px-8 pt-10 pb-9 text-center">
          {current.illustration && (
            <div className="mx-auto mb-5 relative w-32 h-32">
              {!reduced && (
                <div
                  className="absolute inset-0 rounded-full celebration-halo"
                  style={{
                    background: `radial-gradient(circle, ${accent.headline}44 0%, transparent 70%)`,
                  }}
                  aria-hidden="true"
                />
              )}
              <img
                src={current.illustration}
                alt=""
                width={128}
                height={128}
                className={`relative w-32 h-32 object-contain ${reduced ? "" : "celebration-illustration"}`}
                style={{ filter: `drop-shadow(0 8px 24px ${accent.headline}55)` }}
                aria-hidden="true"
              />
            </div>
          )}

          <p
            className="font-mono uppercase tracking-[0.36em] text-[10px] mb-3 celebration-eyebrow"
            style={{ color: accent.headline, opacity: 0.85 }}
          >
            {current.eyebrow}
          </p>

          <h2
            className="font-bebas text-5xl sm:text-6xl tracking-wider leading-none mb-3"
            style={{
              color: accent.headline,
              textShadow: `0 0 28px ${accent.headline}66, 0 0 60px ${accent.headline}33`,
            }}
          >
            <RevealText
              text={current.headline}
              color={accent.headline}
              glow={`0 0 12px ${accent.headline}88`}
              delay={0.12}
              charDelay={0.03}
            />
          </h2>

          {current.description && (
            <p className="text-cream/70 text-sm leading-relaxed mb-5 max-w-xs mx-auto">
              {current.description}
            </p>
          )}

          {typeof current.fangs === "number" && current.fangs > 0 && (
            <div
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full border ${
                reduced ? "" : "celebration-chip"
              }`}
              style={{
                background: "rgba(255,215,0,0.10)",
                borderColor: "rgba(255,215,0,0.45)",
                boxShadow: "0 0 24px rgba(255,215,0,0.18)",
              }}
            >
              <Coin size={18} weight="fill" color="#FFD700" aria-hidden="true" />
              <span className="font-bebas text-2xl text-[#FFD700] tracking-wider leading-none">
                +{current.fangs} FANGS
              </span>
            </div>
          )}

          {celebrations.length > 1 && (
            <div className="mt-6 flex items-center justify-center gap-1.5" aria-hidden="true">
              {celebrations.map((c, i) => (
                <span
                  key={c.id}
                  className="block rounded-full transition-colors"
                  style={{
                    width: i === index ? 18 : 6,
                    height: 4,
                    background:
                      i === index
                        ? accent.headline
                        : i < index
                        ? "rgba(238,244,255,0.35)"
                        : "rgba(238,244,255,0.12)",
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {!reduced && (
          <div
            className="absolute left-0 right-0 bottom-0 h-[3px] celebration-progress"
            style={{
              background: `linear-gradient(90deg, ${accent.headline}, ${accent.headline}88)`,
              animationDuration: `${autoDismissMs}ms`,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      <style jsx>{`
        @keyframes celebration-card-in {
          0% { transform: translateY(24px) scale(0.94); opacity: 0; }
          60% { transform: translateY(-4px) scale(1.02); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes celebration-card-out {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-12px) scale(0.97); opacity: 0; }
        }
        @keyframes celebration-illustration-pop {
          0% { transform: scale(0.6) rotate(-8deg); opacity: 0; }
          55% { transform: scale(1.08) rotate(4deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes celebration-halo-pulse {
          0%, 100% { transform: scale(0.92); opacity: 0.55; }
          50% { transform: scale(1.08); opacity: 0.95; }
        }
        @keyframes celebration-chip-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes celebration-orb-drift-a {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(18px, 14px); }
        }
        @keyframes celebration-orb-drift-b {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-22px, -10px); }
        }
        @keyframes celebration-progress-shrink {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }
        @keyframes celebration-eyebrow-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 0.85; transform: translateY(0); }
        }

        .celebration-card-enter {
          will-change: transform, opacity;
          animation: celebration-card-in 480ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .celebration-card-exit {
          will-change: transform, opacity;
          animation: celebration-card-out 240ms cubic-bezier(0.4, 0, 1, 1) both;
        }
        .celebration-illustration {
          will-change: transform, opacity;
          animation: celebration-illustration-pop 720ms cubic-bezier(0.16, 1, 0.3, 1) 80ms both;
        }
        .celebration-halo {
          will-change: transform, opacity;
          animation: celebration-halo-pulse 2400ms ease-in-out infinite;
        }
        .celebration-chip {
          will-change: transform;
          animation: celebration-chip-bob 2200ms ease-in-out 600ms infinite;
        }
        .celebration-orb-a {
          will-change: transform;
          animation: celebration-orb-drift-a 4800ms ease-in-out infinite;
        }
        .celebration-orb-b {
          will-change: transform;
          animation: celebration-orb-drift-b 5400ms ease-in-out infinite;
        }
        .celebration-progress {
          transform-origin: left center;
          will-change: transform;
          animation-name: celebration-progress-shrink;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
        .celebration-eyebrow {
          will-change: opacity, transform;
          animation: celebration-eyebrow-in 360ms cubic-bezier(0.16, 1, 0.3, 1) 60ms both;
        }

        @media (prefers-reduced-motion: reduce) {
          .celebration-card-enter,
          .celebration-card-exit,
          .celebration-illustration,
          .celebration-halo,
          .celebration-chip,
          .celebration-orb-a,
          .celebration-orb-b,
          .celebration-progress,
          .celebration-eyebrow {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
