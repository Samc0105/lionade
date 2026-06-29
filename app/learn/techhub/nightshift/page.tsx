"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Moon } from "@phosphor-icons/react";
import dynamic from "next/dynamic";

// Light placeholder shown while the heavy chunk loads. It matches the dark glass
// chrome and shows neutral bars (never a zero), so the route shell paints
// instantly with no flash of empty content. The pulse is motion safe, so it
// stays still when the player prefers reduced motion.
function LoadingPanel() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 motion-safe:animate-pulse"
    >
      <div className="h-5 w-40 rounded bg-white/[0.06]" />
      <div className="mt-4 grid gap-3">
        <div className="h-20 rounded-xl bg-white/[0.04]" />
        <div className="h-20 rounded-xl bg-white/[0.04]" />
        <div className="h-20 rounded-xl bg-white/[0.04]" />
      </div>
    </div>
  );
}

// Code split: the Night Shift station (its own reducer, audio, and timers) only
// ships when a player opens it, keeping it out of the TechHub initial bundle. It
// reads localStorage for best nights, so it is client only (ssr false).
const NightShift = dynamic(() => import("@/components/liondesk/NightShift"), {
  ssr: false,
  loading: () => <LoadingPanel />,
});

// Night Shift, the FNAF-style SOC monitoring mode. Dark station, flippable
// feeds, a threat that creeps toward the core in real time. Authored + zero API.
export default function NightShiftPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Moon size={34} weight="fill" color="#6E8BC0" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">NIGHT SHIFT</h1>
            <p className="text-cream/50 text-sm mt-0.5">Watch the feeds. Catch the intruder. Survive til 6 AM.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <NightShift />
        </div>
      </div>
    </ProtectedRoute>
  );
}
