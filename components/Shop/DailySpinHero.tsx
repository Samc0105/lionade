"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { mutateUserStats } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { toastError } from "@/lib/toast";
import SpinWheel, { type WheelSlot } from "./SpinWheel";
import SpinResultModal, { type SpinResult } from "./SpinResultModal";
import { Sparkle, Lock, Info, X } from "@phosphor-icons/react";

// Cosmetic mirror of SPIN_SLOTS — labels + colors only. NO probabilities.
// The server is the source of truth for the roll; this is just for the
// wheel rendering. Order MUST match `SPIN_SLOTS` in `lib/spin.ts` so
// `slotIndex` returned by the API points at the right segment.
const WHEEL_SLOTS: WheelSlot[] = [
  { outcome: "small_fangs",   label: "+ Fangs",      color: "#4A90D9" },
  { outcome: "bust",          label: "Bust",         color: "#475569" },
  { outcome: "medium_fangs",  label: "++ Fangs",     color: "#22C55E" },
  { outcome: "booster",       label: "Booster",      color: "#A855F7" },
  { outcome: "big_fangs",     label: "+++ Fangs",    color: "#0EA5E9" },
  { outcome: "mega_fangs",    label: "Mega",         color: "#F59E0B" },
  { outcome: "streak_shield", label: "Shield",       color: "#EF4444" },
  { outcome: "rare_cosmetic", label: "Rare",         color: "#EC4899" },
  { outcome: "tax_man",       label: "Tax Man",      color: "#7F1D1D" },
  { outcome: "jackpot",       label: "JACKPOT",      color: "#FFD700" },
];

interface SpinStatus {
  canSpin: boolean;
  lastSpinAt: string | null;
  nextSpinAt: string | null;
  cooldownMs: number;
  lastOutcome: { outcome: string; fangsDelta: number } | null;
}

export default function DailySpinHero() {
  const { user } = useAuth();

  // useAuth seeds `user` from localStorage on the client only — defer all
  // auth-driven render until mount so SSR and first client render match.
  // Same pattern Navbar/ProtectedRoute use; required because this hero
  // mounts inside the shop page tree without its own ProtectedRoute gate.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data: status, mutate: mutateStatus } = useSWR<SpinStatus>(
    mounted && user?.id ? "/api/spin/status" : null,
    swrFetcher,
    { refreshInterval: 60_000 },
  );

  const [spinning, setSpinning] = useState(false);
  const [landingIndex, setLandingIndex] = useState<number | null>(null);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  // `now` is only set client-side after mount. SSR uses 0 so countdown
  // serializes deterministically to the initial render value.
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); }, []);

  // Tick the countdown clock once a second when on cooldown
  useEffect(() => {
    if (status?.canSpin) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status?.canSpin]);

  const remainingMs = useMemo(() => {
    if (!status?.nextSpinAt) return 0;
    return Math.max(0, new Date(status.nextSpinAt).getTime() - now);
  }, [status?.nextSpinAt, now]);

  const countdown = useMemo(() => {
    const total = Math.floor(remainingMs / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }, [remainingMs]);

  // Auto-flip to "can spin" when the countdown hits 0
  useEffect(() => {
    if (status?.canSpin) return;
    if (remainingMs > 0) return;
    void mutateStatus();
  }, [remainingMs, status?.canSpin, mutateStatus]);

  const handleSpin = async () => {
    if (spinning || !status?.canSpin) return;
    setSpinning(true);

    const r = await apiPost<{
      outcome: string;
      slotIndex: number;
      fangsDelta: number;
      intendedDelta: number;
      balanceBefore: number;
      balanceAfter: number;
      rewardPayload: Record<string, unknown> | null;
    }>("/api/spin/roll", {});

    if (!r.ok || !r.data) {
      setSpinning(false);
      toastError(r.error || "Couldn't spin right now. Try again in a sec.");
      void mutateStatus();
      return;
    }

    setLandingIndex(r.data.slotIndex);

    // Wait for the wheel animation (5s) before revealing the modal.
    setTimeout(() => {
      setResult({
        outcome: r.data!.outcome,
        fangsDelta: r.data!.fangsDelta,
        intendedDelta: r.data!.intendedDelta,
        balanceBefore: r.data!.balanceBefore,
        balanceAfter: r.data!.balanceAfter,
        rewardPayload: r.data!.rewardPayload,
      });
      setSpinning(false);
      // Refresh user stats (coins) and spin status
      if (user?.id) mutateUserStats(user.id);
      void mutateStatus();
    }, 5200);
  };

  const closeResult = () => {
    setResult(null);
    setLandingIndex(null);
  };

  // Hold render until after mount — eliminates SSR/CSR mismatch since
  // status, countdown, and the wheel state are all driven by client-only
  // sources (localStorage seed, Date.now, useSWR fetch).
  if (!mounted) {
    return (
      <div className="mb-8">
        <div
          aria-hidden="true"
          className="relative rounded-2xl overflow-hidden border border-gold/25 h-[280px] motion-safe:animate-pulse"
          style={{
            background: "linear-gradient(135deg, #150f08 0%, #0d0a06 35%, #060c18 100%)",
          }}
        />
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div
        className="relative rounded-2xl overflow-hidden border border-gold/25"
        style={{
          background:
            "linear-gradient(135deg, #150f08 0%, #0d0a06 35%, #060c18 100%)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.45), inset 0 0 60px rgba(255,215,0,0.04)",
        }}
      >
        {/* Decorative ring patterns */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            background:
              "radial-gradient(circle at 20% 50%, rgba(255,215,0,0.12) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(168,85,247,0.08) 0%, transparent 50%)",
          }}
        />

        <div className="relative grid md:grid-cols-[1fr,360px] gap-8 p-6 sm:p-8 items-center">
          {/* Left side — copy + CTA */}
          <div>
            <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full bg-gold/10 border border-gold/30">
              <Sparkle size={12} weight="fill" color="#FFD700" aria-hidden="true" />
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold">
                Daily Spin
              </span>
            </div>
            <h2 className="font-bebas text-4xl sm:text-5xl text-cream tracking-[0.05em] leading-none mb-3">
              SPIN THE WHEEL
            </h2>
            <p className="text-cream/60 text-sm sm:text-base mb-2 leading-relaxed">
              One free spin every 24 hours. Mostly good: Fangs, boosters, even
              the jackpot.
            </p>
            <p className="text-gold/85 text-xs sm:text-sm font-semibold tracking-wide mb-6">
              Many ways to win. Only{" "}
              <span className="text-red-400">2 ways to lose</span>.
            </p>

            {status?.canSpin ? (
              <button
                type="button"
                onClick={handleSpin}
                disabled={spinning}
                aria-busy={spinning}
                aria-label={spinning ? "Spinning the wheel" : "Spin the wheel now"}
                className="group inline-flex items-center justify-center gap-2 min-h-[44px] px-7 py-3.5 rounded-full font-bold text-sm tracking-wide bg-gold text-navy hover:bg-gold/90 motion-safe:active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-gold/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              >
                <Sparkle
                  size={16}
                  weight="fill"
                  className="motion-safe:group-hover:rotate-12 transition-transform"
                  aria-hidden="true"
                />
                {spinning ? "Spinning..." : "Spin Now"}
              </button>
            ) : (
              <div className="inline-flex items-center gap-3 px-5 py-3 rounded-full bg-white/[0.04] border border-white/[0.08]">
                <Lock size={14} weight="fill" color="#94a3b8" aria-hidden="true" />
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/60 leading-none">
                    Next spin in
                  </p>
                  <p className="font-bebas text-2xl text-cream tracking-wider tabular-nums leading-tight mt-0.5">
                    {countdown}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right side — wheel */}
          <div className="flex items-center justify-center">
            <SpinWheel
              slots={WHEEL_SLOTS}
              spinning={spinning}
              landingIndex={landingIndex}
              size={320}
            />
          </div>
        </div>

        {/* Info button — opens an explainer overlay listing every outcome */}
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          aria-label="How the wheel works"
          className="absolute bottom-3 right-3 z-10 grid place-items-center w-9 h-9 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-cream/70 hover:text-cream transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
        >
          <Info size={14} weight="bold" aria-hidden="true" />
        </button>

        {/* Polite live region announcing the spin lifecycle to AT. */}
        <span role="status" aria-live="polite" className="sr-only">
          {spinning ? "Spinning the wheel" : ""}
        </span>
      </div>

      {showInfo && <SpinInfoModal onClose={() => setShowInfo(false)} />}

      {result && <SpinResultModal result={result} onClose={closeResult} />}
    </div>
  );
}

// ─── Info modal — explainer for each outcome ────────────────────────────────
const INFO_ROWS: { color: string; chance: string; label: string; desc: string; tone: "win" | "neutral" | "bad" | "jackpot" }[] = [
  { color: "#4A90D9", chance: "30%",  label: "Small Fangs",   desc: "50 to 150 Fangs, the most common pull.",                tone: "win" },
  { color: "#22C55E", chance: "20%",  label: "Medium Fangs",  desc: "200 to 400 Fangs. A solid pull.",                       tone: "win" },
  { color: "#A855F7", chance: "15%",  label: "Free Booster",  desc: "A random booster lands in your inventory.",          tone: "win" },
  { color: "#0EA5E9", chance: "12%",  label: "Big Fangs",     desc: "500 to 1,000 Fangs. Heavy bag.",                        tone: "win" },
  { color: "#F59E0B", chance: "5%",   label: "Mega Fangs",    desc: "Flat 2,000 Fangs.",                                  tone: "win" },
  { color: "#EF4444", chance: "3%",   label: "Streak Shield", desc: "One free streak save, protects you for 1 day.",     tone: "win" },
  { color: "#EC4899", chance: "3%",   label: "Rare Cosmetic", desc: "A surprise rare item. Already own them all? Falls back to 1,000 Fangs.", tone: "win" },
  { color: "#475569", chance: "8%",   label: "BUST",          desc: "−500 Fangs flat. Better luck tomorrow. Caps at 0, never goes negative.", tone: "bad" },
  { color: "#7F1D1D", chance: "2%",   label: "TAX MAN",       desc: "−33% of your current Fangs. Scales with your stash. The brutal one.", tone: "bad" },
  { color: "#FFD700", chance: "2%",   label: "JACKPOT",       desc: "10,000 Fangs. Yes, really.",                         tone: "jackpot" },
];

function SpinInfoModal({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus the close control on open, restore focus to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => closeRef.current?.focus());
    return () => { cancelAnimationFrame(id); trigger?.focus?.(); };
  }, []);

  // Escape closes; Tab is trapped within the card.
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

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spin-info-title"
    >
      {/* Blurred backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-md cursor-default"
      />

      <div
        ref={cardRef}
        className="relative w-full max-w-lg rounded-2xl border border-gold/25 overflow-hidden max-h-[85vh] flex flex-col"
        style={{
          background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
          boxShadow: "0 30px 80px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-3 border-b border-white/[0.06]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold/70 mb-1">
              How it works
            </p>
            <h3 id="spin-info-title" className="font-bebas text-2xl text-cream tracking-[0.05em]">
              SPIN THE WHEEL
            </h3>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-9 h-9 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-cream/70 hover:text-cream transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            <X size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {/* Body — scrollable list of every outcome */}
        <div className="overflow-y-auto px-6 py-4">
          <p className="text-cream/60 text-sm leading-relaxed mb-4">
            One free spin every 24 hours. The result is rolled on the server,
            no client tampering possible. Below: every slot, the odds, and what
            it does.
          </p>

          <div className="space-y-2.5">
            {INFO_ROWS.map((row) => (
              <div
                key={row.label}
                className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-white/[0.025] border border-white/[0.05]"
              >
                <span
                  className="flex-shrink-0 mt-0.5 w-3 h-3 rounded-full"
                  style={{ background: row.color, boxShadow: `0 0 8px ${row.color}55` }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span
                      className={`font-bebas text-base tracking-wide ${
                        row.tone === "jackpot" ? "text-gold" : row.tone === "bad" ? "text-red-400" : "text-cream"
                      }`}
                    >
                      {row.label}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/60">
                      {row.chance}
                    </span>
                  </div>
                  <p className="text-cream/55 text-xs leading-relaxed">{row.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 px-3 py-3 rounded-lg bg-gold/[0.05] border border-gold/20">
            <p className="text-gold/85 text-xs font-semibold tracking-wide mb-1">
              Plan multipliers
            </p>
            <p className="text-cream/55 text-xs leading-relaxed">
              <span className="text-cream font-semibold">Pro</span> +25% on
              positive payouts ·{" "}
              <span className="text-cream font-semibold">Platinum</span> +50%.
              Bust and Tax Man are the same for everyone. The gamble is the
              gamble.
            </p>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="px-6 py-4 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[44px] py-2.5 rounded-xl font-semibold text-sm tracking-wide bg-gold text-navy hover:bg-gold/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
