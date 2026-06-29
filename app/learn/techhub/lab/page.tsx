"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Flask } from "@phosphor-icons/react";
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

// Code split: the Mutator Lab builder (and the LionDesk runner it launches) only
// ships when a player opens the lab. It reads localStorage for saved combos, so
// it is client only (ssr false).
const MutatorLab = dynamic(() => import("@/components/liondesk/MutatorLab"), {
  ssr: false,
  loading: () => <LoadingPanel />,
});

// Mutator Lab, build your own shift: pick the track, size, and modifiers, save
// favorite combos, or roll Chaos. All from the same authored pool.
export default function LabPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Flask size={34} weight="fill" color="#A855F7" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">MUTATOR LAB</h1>
            <p className="text-cream/50 text-sm mt-0.5">Build your own shift. Pick the track, the size, and the chaos.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <MutatorLab />
        </div>
      </div>
    </ProtectedRoute>
  );
}
