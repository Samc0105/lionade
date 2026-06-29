"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Scroll } from "@phosphor-icons/react";
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

// Code split: the certification exam (LionDesk plus the certificate canvas) only
// ships when a player opens the exam. It reads localStorage for the best saved
// certificate, so it is client only (ssr false).
const ExamMode = dynamic(() => import("@/components/liondesk/ExamMode"), {
  ssr: false,
  loading: () => <LoadingPanel />,
});

// Certification exam (Idea 32): a timed, fixed length, mixed concept exam drawn
// across every track. Clear the pass bar to earn a shareable certificate.
// Authored content, zero API, deterministic daily form. The certificate is
// cosmetic and the Fangs a run previews are granted server side only; nothing
// here grants from the client.
export default function ExamPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Scroll size={34} weight="fill" color="#FFD700" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">CERTIFICATION EXAM</h1>
            <p className="text-cream/50 text-sm mt-0.5">One timed exam across every track. Pass it to earn your certificate.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <ExamMode />
        </div>
      </div>
    </ProtectedRoute>
  );
}
