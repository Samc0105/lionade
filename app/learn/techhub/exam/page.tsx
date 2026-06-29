"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Scroll } from "@phosphor-icons/react";
import ExamMode from "@/components/liondesk/ExamMode";

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
