"use client";

// Brand maintenance screen for the feature-flag kill-switch.
//
// Modeled on app/not-found.tsx: dark #04080F field, ambient gold + purple
// drift that prefers-reduced-motion disables, font-bebas headline. Renders the
// admin-supplied message in the body and an ETA footer line when present.
//
// Two shapes:
//   - full screen  (compact=false, default): for a whole page / the site gate
//   - inline card  (compact=true): for a sub-feature wrap inside FeatureGate

import { Wrench, HourglassMedium } from "@phosphor-icons/react";

interface MaintenanceStateProps {
  flag: { message: string | null; eta: string | null } | null;
  /** inline card for a sub-feature wrap vs full-screen for a page */
  compact?: boolean;
}

const DRIFT_STYLES = `
  @keyframes ms-drift-gold {
    0%, 100% { transform: translate3d(-4%, -2%, 0) scale(1); opacity: 0.55; }
    50%      { transform: translate3d(4%, 3%, 0) scale(1.08); opacity: 0.75; }
  }
  @keyframes ms-drift-purple {
    0%, 100% { transform: translate3d(3%, 2%, 0) scale(1.04); opacity: 0.45; }
    50%      { transform: translate3d(-3%, -3%, 0) scale(0.96); opacity: 0.6; }
  }
  @keyframes ms-fade-up {
    from { opacity: 0; transform: translate3d(0, 12px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes ms-wrench-sway {
    0%, 100% { transform: rotate(-8deg); }
    50%      { transform: rotate(8deg); }
  }
  .ms-drift-gold   { animation: ms-drift-gold 14s ease-in-out infinite; will-change: transform, opacity; }
  .ms-drift-purple { animation: ms-drift-purple 18s ease-in-out infinite; will-change: transform, opacity; }
  .ms-fade-up      { animation: ms-fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both; will-change: transform, opacity; }
  .ms-wrench-sway  { animation: ms-wrench-sway 4s ease-in-out infinite; transform-origin: 50% 50%; will-change: transform; }
  @media (prefers-reduced-motion: reduce) {
    .ms-drift-gold, .ms-drift-purple, .ms-fade-up, .ms-wrench-sway { animation: none; }
  }
`;

export default function MaintenanceState({ flag, compact = false }: MaintenanceStateProps) {
  const message = flag?.message?.trim() || "We're making this part of Lionade better. Check back shortly.";
  const eta = flag?.eta?.trim() || null;

  const content = (
    <div className="relative text-center max-w-xl mx-auto ms-fade-up">
      <div
        className="inline-flex items-center justify-center rounded-2xl mb-6"
        style={{
          width: compact ? 56 : 76,
          height: compact ? 56 : 76,
          background: "rgba(255,215,0,0.08)",
          boxShadow: "0 0 0 1px rgba(255,215,0,0.25) inset",
        }}
      >
        <Wrench
          className="ms-wrench-sway text-gold"
          weight="duotone"
          size={compact ? 28 : 38}
        />
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-cream/40 mb-3">
        Maintenance
      </p>

      <h1
        className="font-bebas text-cream tracking-wider leading-none"
        style={{
          fontSize: compact ? "clamp(34px, 6vw, 48px)" : "clamp(48px, 9vw, 88px)",
          textShadow:
            "0 0 40px rgba(255,215,0,0.18), 0 0 80px rgba(182,160,255,0.12)",
        }}
      >
        WE'RE WORKING ON IT
      </h1>

      <p className="text-cream/60 text-sm md:text-base leading-relaxed mt-4 max-w-md mx-auto">
        {message}
      </p>

      {eta ? (
        <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-cream/45 mt-7 px-3 py-1.5 rounded-full border border-white/10 bg-white/5">
          <HourglassMedium weight="duotone" size={14} className="text-purple" />
          Back by {eta}
        </p>
      ) : null}
    </div>
  );

  if (compact) {
    return (
      <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur px-6 py-10">
        <style>{DRIFT_STYLES}</style>
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none ms-drift-gold"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 30% 30%, rgba(255,215,0,0.08) 0%, transparent 60%)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none ms-drift-purple"
          style={{
            background:
              "radial-gradient(ellipse 55% 45% at 75% 70%, rgba(182,160,255,0.08) 0%, transparent 65%)",
          }}
        />
        <div className="relative">{content}</div>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden"
      style={{ background: "#04080F" }}
    >
      <style>{DRIFT_STYLES}</style>

      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none ms-drift-gold"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 30% 30%, rgba(255,215,0,0.10) 0%, transparent 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none ms-drift-purple"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 75% 70%, rgba(182,160,255,0.10) 0%, transparent 65%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 50%, transparent 40%, rgba(4,8,15,0.85) 100%)",
        }}
      />

      <div className="relative">{content}</div>
    </div>
  );
}
