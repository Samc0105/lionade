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
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6"
      style={{ background: "#04080F" }}>
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6">⚠️</div>
        <h2 className="font-bebas text-4xl text-cream tracking-wider mb-3">
          SOMETHING WENT WRONG
        </h2>
        <p className="text-cream/40 text-sm mb-8 leading-relaxed">
          An unexpected error occurred. Try refreshing, or head back to the dashboard.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="font-syne font-bold text-sm px-6 py-3 rounded-xl transition-all duration-200 active:scale-95"
            style={{
              background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
              color: "#04080F",
            }}
          >
            Try Again
          </button>
          <Link href="/dashboard"
            className="font-syne font-bold text-sm px-6 py-3 rounded-xl transition-all duration-200 active:scale-95 text-center"
            style={{
              border: "1px solid rgba(74,144,217,0.4)",
              color: "#4A90D9",
            }}
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
