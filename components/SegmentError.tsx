"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Scoped fallback shared by route-segment error.tsx boundaries. Unlike
 * app/error.tsx (a full-screen root fallback), this renders inside the app
 * shell, so the nav and chrome stay intact and only the failed segment's
 * content is replaced. Gives per-segment isolation: a crash in /social does not
 * surface the generic full-screen root fallback or take down the whole app.
 */
export default function SegmentError({
  error,
  reset,
  label,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  label?: string;
}) {
  useEffect(() => {
    console.error(`[${label ?? "segment"}/error.tsx]`, error);
  }, [error, label]);

  return (
    <div className="flex items-center justify-center px-6 py-24">
      <div className="text-center max-w-md">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/40 mb-3">
          Unexpected drift
        </p>
        <h2 className="font-bebas text-cream tracking-wider text-4xl mb-3">
          This part hit a snag
        </h2>
        <p className="text-cream/55 text-sm leading-relaxed mb-7">
          Something in this section failed to load. Try again, or head back to your dashboard. The rest of Lionade is still running.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="font-syne font-bold text-sm px-6 py-2.5 rounded-xl active:scale-[0.97] transition-transform"
            style={{ background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)", color: "#04080F" }}
          >
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="font-syne font-bold text-sm px-6 py-2.5 rounded-xl text-cream/90 inline-block active:scale-[0.97] transition-transform"
            style={{ border: "1px solid rgba(182,160,255,0.35)", background: "rgba(182,160,255,0.06)" }}
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
