"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Compass } from "@phosphor-icons/react";
import PlacementTest from "@/components/liondesk/PlacementTest";

// Placement test (Idea 40): a short, mixed concept quiz that recommends a
// starting career track and difficulty for newcomers, then deep links them
// straight in. Authored and deterministic, zero API, client only. The result is
// advisory and grants nothing; the economy stays server authoritative. Matches
// the TechHub chrome (ProtectedRoute, BackButton, animate-slide-up entrance,
// which is reduced motion safe).
export default function PlacementPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Compass size={34} weight="fill" color="#C9A2F2" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">FIND YOUR TRACK</h1>
            <p className="text-cream/50 text-sm mt-0.5">A quick placement test to recommend a starting track and difficulty. New here? Start here.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <PlacementTest />
        </div>
      </div>
    </ProtectedRoute>
  );
}
