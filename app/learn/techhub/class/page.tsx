"use client";

import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { UsersThree } from "@phosphor-icons/react";
import ClassChallenge from "@/components/liondesk/ClassChallenge";

// Idea 33: Team / classroom challenge mode. A link based way for a teacher to fix
// one exact shift for a whole class and collect everyone's results, with no server
// (the shift and the results both ride on the shareable seed code). ?code=<class
// code> opens the student play view; with no code the teacher builds a link and
// collects results. ?result=<code> prefills the collector from a results link.
export default function ClassPage() {
  const sp = useSearchParams();
  const code = sp?.get("code") ?? undefined;
  const result = sp?.get("result") ?? undefined;

  const sub = code
    ? "Your class is all playing the same shift. Play it, then send your result back to your teacher."
    : "Set one shift for your whole class, share the link, and collect everyone's results. No server, no sign up.";

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <UsersThree size={34} weight="fill" color="#FFD700" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">CLASS CHALLENGE</h1>
            <p className="text-cream/50 text-sm mt-0.5">{sub}</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <ClassChallenge code={code} prefillResult={result} />
        </div>
      </div>
    </ProtectedRoute>
  );
}
