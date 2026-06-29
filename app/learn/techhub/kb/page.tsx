"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { BookOpen } from "@phosphor-icons/react";
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

// Code split: the knowledge base browser only ships when a player opens it,
// keeping its large reverse index out of the TechHub initial bundle. It builds a
// pure, deterministic index (no localStorage, no server reads) that renders the
// same on the server and the client, so server rendering stays on (no flash).
const KbBrowser = dynamic(() => import("@/components/liondesk/KbBrowser"), {
  loading: () => <LoadingPanel />,
});

// In game knowledge base browser: a searchable, filterable index of every KB
// article a player meets on the desk, grouped by the support concept it relates
// to (via lib/liondesk/concepts.ts). Read only and static (it draws from the
// existing KB union built in pool.ts), so it grants nothing and the economy
// stays server authoritative. Matches the TechHub chrome (ProtectedRoute,
// BackButton, animate-slide-up entrance, which is reduced motion safe).
export default function KbPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <BookOpen size={34} weight="fill" color="#4A90D9" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">KNOWLEDGE BASE</h1>
            <p className="text-cream/50 text-sm mt-0.5">Every article you meet on the desk, searchable and grouped by concept. Study between shifts.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <KbBrowser />
        </div>
      </div>
    </ProtectedRoute>
  );
}
