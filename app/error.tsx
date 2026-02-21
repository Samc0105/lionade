"use client";

import { useEffect } from "react";

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
    <div className="min-h-screen bg-navy flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <span className="text-5xl block mb-4">&#x26A0;&#xFE0F;</span>
        <h2 className="font-bebas text-3xl text-cream tracking-wider mb-2">
          SOMETHING WENT WRONG
        </h2>
        <p className="text-cream/40 text-sm mb-6 leading-relaxed">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          className="font-syne font-bold text-sm px-6 py-2.5 rounded-lg transition-all duration-200
            active:scale-95 text-navy bg-electric hover:bg-electric-light"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
