"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Moon } from "@phosphor-icons/react";
import NightShift from "@/components/liondesk/NightShift";

// Night Shift — the FNAF-style SOC monitoring mode. Dark station, flippable
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
