"use client";

import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Shuffle } from "@phosphor-icons/react";
import PlayGeneratedShift from "@/components/liondesk/PlayGeneratedShift";

// Surprise Shift / Daily Combo — a procedurally combined shift. ?daily=1 seeds
// it by the date so it's the same for everyone today.
export default function SurprisePage() {
  const sp = useSearchParams();
  const daily = sp?.get("daily") === "1";

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Shuffle size={34} weight="fill" color="#A855F7" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">{daily ? "DAILY COMBO" : "SURPRISE SHIFT"}</h1>
            <p className="text-cream/50 text-sm mt-0.5">{daily ? "Today's mix of tickets and mutators. Same for everyone." : "A random mix of tickets and mutators. No two runs alike."}</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <PlayGeneratedShift daily={daily} />
        </div>
      </div>
    </ProtectedRoute>
  );
}
