"use client";

import { useParams, useSearchParams, notFound } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Desktop } from "@phosphor-icons/react";
import Campaign from "@/components/liondesk/Campaign";
import { shiftsForTrack } from "@/lib/liondesk/shifts";
import { getTrack } from "@/lib/helpdesk/tracks";
import type { Track } from "@/lib/helpdesk/types";

// LionDesk campaign — the immersive "shift" simulator. Any track that has
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
