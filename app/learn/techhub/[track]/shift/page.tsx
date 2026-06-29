"use client";

import { useParams, useSearchParams, notFound } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Desktop } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import { shiftsForTrack } from "@/lib/liondesk/shifts";
import { getTrack } from "@/lib/helpdesk/tracks";
import type { Track } from "@/lib/helpdesk/types";

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

// Code split: the campaign simulator (LionDesk plus the shift engine) only ships
// when a player opens a shift, keeping it out of the TechHub initial bundle. It
// reads localStorage for campaign records, so it is client only (ssr false).
const Campaign = dynamic(() => import("@/components/liondesk/Campaign"), {
  ssr: false,
  loading: () => <LoadingPanel />,
});

// LionDesk campaign, the immersive "shift" simulator. Any track that has
// shifts gets a campaign here; tracks without one fall through to notFound.
export default function ShiftPage() {
  const params = useParams<{ track: string }>();
  const searchParams = useSearchParams();
  const track = params?.track as Track | undefined;
  if (!track || shiftsForTrack(track).length === 0) notFound();
  const def = getTrack(track);
  const initialShiftId = searchParams?.get("shift") ?? undefined;

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
        <BackButton href={`/learn/techhub/${track}`} label={def?.name ?? "TechHub"} />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Desktop size={36} weight="fill" color={def?.color ?? "#4A90D9"} aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">LIONDESK</h1>
            <p className="text-cream/50 text-sm mt-0.5">Clock in. Work the queue. Climb the ladder.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <Campaign track={track} initialShiftId={initialShiftId} />
        </div>
      </div>
    </ProtectedRoute>
  );
}
