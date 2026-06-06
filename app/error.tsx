"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error.tsx] unhandled", error);
  }, [error]);

  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden"
      style={{ background: "#04080F" }}
    >
      <style>{`
        @keyframes err-drift-a {
          0%, 100% { transform: translate3d(-3%, -2%, 0) scale(1); opacity: 0.5; }
          50%      { transform: translate3d(4%, 3%, 0) scale(1.07); opacity: 0.7; }
        }
        @keyframes err-drift-b {
          0%, 100% { transform: translate3d(3%, 2%, 0) scale(1.03); opacity: 0.4; }
          50%      { transform: translate3d(-3%, -3%, 0) scale(0.97); opacity: 0.55; }
        }
        @keyframes err-fade-up {
          from { opacity: 0; transform: translate3d(0, 12px, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        .err-drift-a  { animation: err-drift-a 13s ease-in-out infinite; will-change: transform, opacity; }
        .err-drift-b  { animation: err-drift-b 17s ease-in-out infinite; will-change: transform, opacity; }
        .err-fade-up  { animation: err-fade-up 0.55s cubic-bezier(0.16,1,0.3,1) both; will-change: transform, opacity; }
        @media (prefers-reduced-motion: reduce) {
          .err-drift-a, .err-drift-b, .err-fade-up { animation: none; }
        }
      `}</style>

      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none err-drift-a"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 32% 30%, rgba(255,215,0,0.09) 0%, transparent 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none err-drift-b"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 72% 70%, rgba(182,160,255,0.09) 0%, transparent 65%)",
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

      <div className="relative text-center max-w-lg err-fade-up">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-cream/40 mb-4">
          Unexpected drift
        </p>

        <h1
          className="font-bebas text-cream tracking-wider leading-none"
          style={{
            fontSize: "clamp(64px, 12vw, 120px)",
            textShadow:
              "0 0 32px rgba(255,215,0,0.16), 0 0 64px rgba(182,160,255,0.10)",
          }}
        >
          SOMETHING GLITCHED
        </h1>

        <p className="text-cream/55 text-sm md:text-base leading-relaxed mt-6 mb-8 max-w-md mx-auto">
          A circuit popped on our end. Give it another spin, or head home and we'll regroup.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="font-syne font-bold text-sm px-7 py-3 rounded-xl transition-transform duration-200 active:scale-[0.97] hover:-translate-y-0.5"
            style={{
              background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
              color: "#04080F",
              boxShadow:
                "0 8px 24px rgba(255,215,0,0.22), 0 0 0 1px rgba(255,215,0,0.35) inset",
              willChange: "transform",
            }}
          >
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="font-syne font-bold text-sm px-7 py-3 rounded-xl transition-transform duration-200 active:scale-[0.97] hover:-translate-y-0.5 inline-block text-cream/90 text-center"
            style={{
              border: "1px solid rgba(182,160,255,0.35)",
              background: "rgba(182,160,255,0.06)",
              willChange: "transform",
            }}
          >
            Go Home
          </Link>
        </div>

        {error?.digest ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/30 mt-10">
            REF / {error.digest}
          </p>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/30 mt-10">
            ERR / RUNTIME
          </p>
        )}
      </div>
    </div>
  );
}
