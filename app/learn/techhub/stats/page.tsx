"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { ChartLineUp } from "@phosphor-icons/react";
import PerformanceDashboard from "@/components/liondesk/PerformanceDashboard";

// Personal performance dashboard: your per track performance, best scores and
// records, weakest concepts, streak summary, and a simple recent activity trend.
// Read only and local: it reads the same stores the rest of TechHub keeps and
// grants nothing. Zero API, and the economy stays server authoritative.
export default function StatsPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <ChartLineUp size={34} weight="fill" color="#4A90D9" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">YOUR STATS</h1>
            <p className="text-cream/50 text-sm mt-0.5">Per track performance, best scores, weakest concepts, and your recent activity.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <PerformanceDashboard />
        </div>
      </div>
    </ProtectedRoute>
  );
}
