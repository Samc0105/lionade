import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden"
      style={{ background: "#04080F" }}
    >
      <style>{`
        @keyframes drift-gold {
          0%, 100% { transform: translate3d(-4%, -2%, 0) scale(1); opacity: 0.55; }
          50%      { transform: translate3d(4%, 3%, 0) scale(1.08); opacity: 0.75; }
        }
        @keyframes drift-purple {
          0%, 100% { transform: translate3d(3%, 2%, 0) scale(1.04); opacity: 0.45; }
          50%      { transform: translate3d(-3%, -3%, 0) scale(0.96); opacity: 0.6; }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translate3d(0, 12px, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes huge-pulse {
          0%, 100% { opacity: 0.92; transform: translate3d(0,0,0) scale(1); }
          50%      { opacity: 1;    transform: translate3d(0,0,0) scale(1.012); }
        }
        .nf-drift-gold   { animation: drift-gold 14s ease-in-out infinite; will-change: transform, opacity; }
        .nf-drift-purple { animation: drift-purple 18s ease-in-out infinite; will-change: transform, opacity; }
        .nf-fade-up      { animation: fade-in-up 0.6s cubic-bezier(0.16,1,0.3,1) both; will-change: transform, opacity; }
        .nf-huge-pulse   { animation: huge-pulse 6s ease-in-out infinite; will-change: transform, opacity; }
        @media (prefers-reduced-motion: reduce) {
          .nf-drift-gold, .nf-drift-purple, .nf-fade-up, .nf-huge-pulse { animation: none; }
        }
      `}</style>

      {/* Ambient drift, GPU only */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none nf-drift-gold"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 30% 30%, rgba(255,215,0,0.10) 0%, transparent 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none nf-drift-purple"
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

      <div className="relative text-center max-w-xl nf-fade-up">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-cream/40 mb-4">
          Signal lost
        </p>

        <h1
          className="font-bebas text-cream tracking-wider leading-none nf-huge-pulse"
          style={{
            fontSize: "clamp(120px, 22vw, 240px)",
            textShadow:
              "0 0 40px rgba(255,215,0,0.18), 0 0 80px rgba(182,160,255,0.12)",
          }}
        >
          404
        </h1>

        <h2 className="font-bebas text-2xl md:text-3xl text-cream/85 tracking-[0.18em] mt-2 mb-4">
          LOST IN THE COSMOS
        </h2>

        <p className="text-cream/55 text-sm md:text-base leading-relaxed mb-8 max-w-md mx-auto">
          This page slipped through the airlock. Let's get you back to safer orbit.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/dashboard"
            className="font-syne font-bold text-sm px-7 py-3 rounded-xl transition-transform duration-200 active:scale-[0.97] hover:-translate-y-0.5 inline-block"
            style={{
              background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
              color: "#04080F",
              boxShadow:
                "0 8px 24px rgba(255,215,0,0.22), 0 0 0 1px rgba(255,215,0,0.35) inset",
              willChange: "transform",
            }}
          >
            Go to Dashboard
          </Link>
          <Link
            href="/games"
            className="font-syne font-bold text-sm px-7 py-3 rounded-xl transition-transform duration-200 active:scale-[0.97] hover:-translate-y-0.5 inline-block text-cream/90"
            style={{
              border: "1px solid rgba(182,160,255,0.35)",
              background: "rgba(182,160,255,0.06)",
              willChange: "transform",
            }}
          >
            Go to Games
          </Link>
        </div>

        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/30 mt-10">
          ERR / NOT_FOUND / 404
        </p>
      </div>
    </div>
  );
}
