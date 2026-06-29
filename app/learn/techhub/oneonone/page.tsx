"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { ChatsCircle } from "@phosphor-icons/react";
import OneOnOneReview from "@/components/liondesk/OneOnOneReview";

// Manager 1:1 review surface: a periodic performance check in. Every few cleared
// shifts the player sits down with their manager for a line tied to their current
// saga chapter, one or two goals drawn from their weakest concepts, and a review
// of how the last set of goals went. Authored and deterministic, zero API, and
// local only. Nothing here grants Fangs; the economy stays server authoritative.
export default function OneOnOnePage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <ChatsCircle size={34} weight="fill" color="#FFD700" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">MANAGER 1:1</h1>
            <p className="text-cream/50 text-sm mt-0.5">Periodic check ins with your manager, with goals pulled from your weakest concepts.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <OneOnOneReview />
        </div>
      </div>
    </ProtectedRoute>
  );
}
