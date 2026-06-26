"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Terminal } from "@phosphor-icons/react";
import HelpDeskSim from "@/components/helpdesk/HelpDeskSim";

// "Learn by doing" track — a help-desk SIMULATOR. Tickets land in your queue;
// you investigate with a fake terminal and resolve them like the real job.
// Prototype: scenarios are authored JSON (zero API cost) and the Fangs counter
// is display-only — real granting must go through a server route that validates
// the solve (the economy is server-authoritative; never grant Fangs client-side).
export default function HelpDeskSimPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
        <BackButton />

        <div className="flex items-center gap-3 mb-2 animate-slide-up">
          <Terminal size={40} weight="fill" color="#4A90D9" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider leading-none">HELP DESK SIM</h1>
            <p className="text-cream/50 text-sm mt-1">Real tickets. Real terminal. Think like the IT desk and clear the queue.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <HelpDeskSim />
        </div>
      </div>
    </ProtectedRoute>
  );
}
