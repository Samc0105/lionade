"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { Crown, Cards, Coins, Lightning, Skull, Shield, Diamond, X } from "@phosphor-icons/react";
import { cdnUrl } from "@/lib/cdn";
import { formatCoins } from "@/lib/mockData";

export interface SpinResult {
  outcome: string;
  fangsDelta: number;
  intendedDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  rewardPayload: Record<string, unknown> | null;
}

const OUTCOME_VISUALS: Record<
  string,
  { title: string; vibe: "win" | "big" | "jackpot" | "neutral" | "bad"; Icon: typeof Crown; iconColor: string; gradient: string }
> = {
  small_fangs:    { title: "Small Fangs",     vibe: "win",     Icon: Coins,     iconColor: "#4A90D9", gradient: "from-blue-500/20 via-blue-400/10 to-transparent" },
  bust:           { title: "BUST",            vibe: "bad",     Icon: Skull,     iconColor: "#94A3B8", gradient: "from-slate-500/30 via-slate-700/10 to-transparent" },
  medium_fangs:   { title: "Medium Fangs",    vibe: "win",     Icon: Coins,     iconColor: "#22C55E", gradient: "from-green-500/20 via-emerald-500/10 to-transparent" },
  booster:        { title: "Free Booster",    vibe: "win",     Icon: Lightning, iconColor: "#A855F7", gradient: "from-purple-500/20 via-violet-500/10 to-transparent" },
  big_fangs:      { title: "Big Fangs",       vibe: "big",     Icon: Coins,     iconColor: "#0EA5E9", gradient: "from-sky-500/25 via-cyan-500/10 to-transparent" },
  mega_fangs:     { title: "Mega Fangs",      vibe: "big",     Icon: Coins,     iconColor: "#F59E0B", gradient: "from-amber-500/30 via-orange-500/10 to-transparent" },
  streak_shield:  { title: "Streak Shield",   vibe: "win",     Icon: Shield,    iconColor: "#EF4444", gradient: "from-red-500/20 via-orange-500/10 to-transparent" },
  rare_cosmetic:  { title: "Rare Cosmetic",   vibe: "big",     Icon: Diamond,   iconColor: "#EC4899", gradient: "from-pink-500/25 via-fuchsia-500/10 to-transparent" },
  tax_man:        { title: "TAX MAN",         vibe: "bad",     Icon: Skull,     iconColor: "#7F1D1D", gradient: "from-red-900/40 via-red-700/15 to-transparent" },
  jackpot:        { title: "JACKPOT",         vibe: "jackpot", Icon: Crown,     iconColor: "#FFD700", gradient: "from-yellow-400/40 via-amber-300/20 to-transparent" },
};

export default function SpinResultModal({
  result,
  onClose,
}: {
  result: SpinResult;
  onClose: () => void;
}) {
  const visual = OUTCOME_VISUALS[result.outcome] ?? OUTCOME_VISUALS.small_fangs;
  const Icon = visual.Icon;
  const reduce = useReducedMotion();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);

  // Focus the primary CTA on open, restore focus to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => ctaRef.current?.focus());
    return () => { cancelAnimationFrame(id); trigger?.focus?.(); };
  }, []);

  // ESC closes; Tab is trapped within the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const root = cardRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Read the real awarded values off the server payload so this screen can
  // never drift from the reward table again. intendedDelta is the pre-clamp
  // amount the table tried to charge; fangsDelta is what actually landed.
  const taxPercent =
    typeof result.rewardPayload?.percent === "number"
      ? (result.rewardPayload.percent as number)
      : null;
  const rareFallbackFangs =
    typeof result.rewardPayload?.fangs === "number"
      ? (result.rewardPayload.fangs as number)
      : result.fangsDelta;

  // Honest "you only had X" message when Bust clamped. Render the real
  // intended delta rather than a hardcoded number.
  const clampedNote =
    result.outcome === "bust" && result.intendedDelta < result.fangsDelta
      ? `You only had ${formatCoins(result.balanceBefore)} Fangs, so you went to 0 instead of ${formatCoins(result.intendedDelta)}.`
      : null;

  // Description per outcome
  let description: React.ReactNode = "";
  if (result.outcome === "bust") {
    description = clampedNote ?? `Better luck tomorrow, you lost ${formatCoins(Math.abs(result.fangsDelta))} Fangs.`;
  } else if (result.outcome === "tax_man") {
    const pct = taxPercent !== null ? `${taxPercent}%` : "a cut";
    description = `The Tax Man took ${pct} of your stash, ${formatCoins(Math.abs(result.fangsDelta))} Fangs gone.`;
  } else if (result.outcome === "jackpot") {
    description = `You hit the jackpot. ${formatCoins(result.fangsDelta)} Fangs.`;
  } else if (result.outcome === "booster") {
    description = "A random booster has been added to your inventory.";
  } else if (result.outcome === "streak_shield") {
    description = "A 1-day Streak Shield is now in your inventory.";
  } else if (result.outcome === "rare_cosmetic") {
    description = result.rewardPayload?.kind === "rare_cosmetic_fallback"
      ? `You already own all rare cosmetics, converted to ${formatCoins(rareFallbackFangs)} Fangs.`
      : "A surprise rare item has been added to your inventory.";
  } else if (result.fangsDelta > 0) {
    description = `You won ${formatCoins(result.fangsDelta)} Fangs.`;
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spin-result-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm cursor-default"
      />

      {/* Card */}
      <div
        ref={cardRef}
        className={`relative w-full max-w-md rounded-2xl border border-white/10 overflow-hidden ${reduce ? "" : "animate-spin-result-pop"}`}
        style={{
          background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
          boxShadow: "0 30px 80px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Vibe-tinted background wash */}
        <div aria-hidden="true" className={`absolute inset-0 bg-gradient-to-br ${visual.gradient} pointer-events-none`} />

        {/* Jackpot sparkle layer */}
        {visual.vibe === "jackpot" && !reduce && (
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                className="absolute w-1 h-1 rounded-full bg-gold animate-jackpot-sparkle"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 1.5}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 grid place-items-center w-9 h-9 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-cream/70 hover:text-cream transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          aria-label="Close result"
        >
          <X size={14} weight="bold" aria-hidden="true" />
        </button>

        <div className="relative px-8 py-10 text-center">
          {/* Icon */}
          <div
            className="mx-auto mb-5 grid place-items-center w-20 h-20 rounded-full"
            style={{
              background: `${visual.iconColor}1A`,
              border: `2px solid ${visual.iconColor}55`,
              boxShadow: `0 0 30px ${visual.iconColor}40`,
            }}
          >
            <Icon size={40} weight="fill" color={visual.iconColor} aria-hidden="true" />
          </div>

          {/* Title */}
          <h2
            id="spin-result-title"
            className={`font-bebas text-4xl tracking-[0.08em] mb-2 ${visual.vibe === "jackpot" ? "text-gold" : "text-cream"}`}
            style={visual.vibe === "jackpot" ? { textShadow: "0 0 20px rgba(255,215,0,0.5)" } : undefined}
          >
            {visual.title}
          </h2>

          {/* Fangs delta number */}
          {result.fangsDelta !== 0 && (
            <div className="flex items-center justify-center gap-2 mb-4">
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-7 h-7 object-contain" />
              <span
                className={`font-bebas text-3xl tabular-nums ${
                  result.fangsDelta > 0 ? "text-gold" : "text-red-400"
                }`}
              >
                {result.fangsDelta > 0 ? "+" : ""}
                {formatCoins(result.fangsDelta)}
              </span>
            </div>
          )}

          {/* Description */}
          <p className="text-cream/70 text-sm leading-relaxed mb-6">{description}</p>

          {/* New balance */}
          <div className="text-cream/55 text-xs font-mono uppercase tracking-[0.25em]">
            new balance
          </div>
          <div className="flex items-center justify-center gap-2 mt-1.5 mb-6">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
            <span className="font-bebas text-2xl text-cream tracking-wider">
              {formatCoins(result.balanceAfter)}
            </span>
          </div>

          {/* CTA */}
          <button
            ref={ctaRef}
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] py-3 rounded-xl font-semibold text-sm tracking-wide bg-gold text-navy hover:bg-gold/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            Got it
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin-result-pop {
          0% { opacity: 0; transform: scale(0.85); }
          60% { transform: scale(1.04); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes jackpot-sparkle {
          0%, 100% { opacity: 0; transform: scale(0.5); }
          50% { opacity: 1; transform: scale(1.2); box-shadow: 0 0 12px #FFD700; }
        }
        :global(.animate-spin-result-pop) {
          animation: spin-result-pop 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        }
        :global(.animate-jackpot-sparkle) {
          animation: jackpot-sparkle 1.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
