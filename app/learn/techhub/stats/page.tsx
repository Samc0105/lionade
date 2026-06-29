"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { ChartLineUp } from "@phosphor-icons/react";
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

// Code split: the performance dashboard only ships when a player opens their
// stats. It reads localStorage for every number it shows, so it is client only
// (ssr false) and mount guarded inside, which keeps it free of any flash of zero.
const PerformanceDashboard = dynamic(() => import("@/components/liondesk/PerformanceDashboard"), {
  ssr: false,
  loading: () => <LoadingPanel />,
});

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
