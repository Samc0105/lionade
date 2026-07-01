"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Terminal } from "@phosphor-icons/react";
import TechHubHome from "@/components/helpdesk/TechHubHome";
import CommandPalette from "@/components/helpdesk/CommandPalette";
import WhatsNew from "@/components/helpdesk/WhatsNew";

// TechHub, a terminal-driven career simulator. Pick a track (IT support, SOC,
// software, red team), work real tickets in a fake terminal, and climb the rank
// ladder from intern to the top. All scenarios are authored logic (zero API
// cost). Progress is stored locally for now; Fangs/XP shown on a solve are a
// preview and must be granted server-side once a route validates the solve (the
// economy is server-authoritative; never grant Fangs from the client).
export default function TechHubPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
        <BackButton href="/learn" label="Learn" />

        <div className="flex items-center gap-3 mb-5 animate-slide-up">
          <Terminal size={40} weight="fill" color="#4A90D9" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider leading-none">TECHHUB</h1>
            <p className="text-cream/50 text-sm mt-1">Learn tech by doing the job. Work the queue, climb from intern to CTO.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <TechHubHome />
        </div>

        {/* Idea 35: Cmd/Ctrl+K command palette for fast hub navigation. Mounted
            once here; renders its own hint button and keyboard driven overlay. */}
        <CommandPalette />

        {/* Idea 43: What's New highlights + guided tour. Mounted once here; it is
            mount guarded and self opens (no flash) the first time after a version
            bump, then stays out of the way. Pure discovery, grants nothing. */}
        <WhatsNew />
      </div>
    </ProtectedRoute>
  );
}
