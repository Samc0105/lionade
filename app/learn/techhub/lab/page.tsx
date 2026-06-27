"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Flask } from "@phosphor-icons/react";
import MutatorLab from "@/components/liondesk/MutatorLab";

// Mutator Lab — build your own shift: pick the track, size, and modifiers, save
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
