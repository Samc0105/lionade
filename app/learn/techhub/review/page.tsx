"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Target } from "@phosphor-icons/react";
import WeakSpotsReview from "@/components/liondesk/WeakSpotsReview";

// Weak Spots review: concept-level mastery plus a personalized shift biased
// toward the concepts you miss most. Authored content, zero API, local-only
// mastery. The Fangs/XP a solve previews are granted server-side only; nothing
// here grants from the client.
export default function ReviewPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Target size={34} weight="fill" color="#A855F7" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">WEAK SPOTS</h1>
            <p className="text-cream/50 text-sm mt-0.5">See your mastery by concept, then drill the tickets you miss most.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <WeakSpotsReview />
        </div>
      </div>
    </ProtectedRoute>
  );
}
