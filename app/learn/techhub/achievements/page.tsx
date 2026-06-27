"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Trophy } from "@phosphor-icons/react";
import AchievementsPanel from "@/components/liondesk/AchievementsPanel";

export default function AchievementsPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Trophy size={34} weight="fill" color="#FFD700" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">ACHIEVEMENTS</h1>
            <p className="text-cream/50 text-sm mt-0.5">Goals to chase across every track, mutator, and night.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <AchievementsPanel />
        </div>
      </div>
    </ProtectedRoute>
  );
}
