"use client";

import { useParams } from "next/navigation";
import { notFound } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import TrackView from "@/components/helpdesk/TrackView";
import { TRACK_IDS } from "@/lib/helpdesk/tracks";
import type { Track } from "@/lib/helpdesk/types";

export default function TechHubTrackPage() {
  const params = useParams<{ track: string }>();
  const track = params?.track;
  if (!track || !TRACK_IDS.includes(track as Track)) notFound();

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />
        <div className="mt-2 animate-slide-up">
          <TrackView track={track as Track} />
        </div>
      </div>
    </ProtectedRoute>
  );
}
