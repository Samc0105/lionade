"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { GraduationCap } from "@phosphor-icons/react";
import LionDesk from "@/components/liondesk/LionDesk";
import { TUTORIAL_SHIFT } from "@/lib/liondesk/tutorial";

// A gentle guided first shift. Not scored (no onComplete), just practice.
export default function TutorialPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-2 animate-slide-up">
          <GraduationCap size={34} weight="fill" color="#2BBE6B" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">TUTORIAL</h1>
            <p className="text-cream/50 text-sm mt-0.5">Three easy tickets to learn the desk. Read, investigate, decide.</p>
          </div>
        </div>
        <p className="text-cream/60 text-xs mb-4 max-w-xl animate-slide-up">
          Click a ticket on the left to open it. Read the evidence, use the terminal buttons where you see them, then pick your move. No clock pressure here.
        </p>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <LionDesk shift={TUTORIAL_SHIFT} />
        </div>
      </div>
    </ProtectedRoute>
  );
}
