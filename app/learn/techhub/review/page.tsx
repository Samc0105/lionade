"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Target } from "@phosphor-icons/react";
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

// Code split: the weak spots review (LionDesk plus the local mastery store) only
// ships when a player opens it. It reads localStorage for concept mastery, so it
// is client only (ssr false).
const WeakSpotsReview = dynamic(() => import("@/components/liondesk/WeakSpotsReview"), {
  ssr: false,
  loading: () => <LoadingPanel />,
});

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
