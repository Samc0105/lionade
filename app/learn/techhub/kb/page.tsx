"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { BookOpen } from "@phosphor-icons/react";
import KbBrowser from "@/components/liondesk/KbBrowser";

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
