"use client";

// Competitive Arena — per-match screen dispatcher.
//
// Route: /compete/arena/[mode]/[matchId]
// Loads the match state once, then renders the mode-specific screen component.
// Each mode component owns its own gameplay loop + realtime, and calls the
// shared /complete endpoint when the rounds are exhausted.

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { apiGet } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { isCompetitiveMode, type CompetitiveMatchRow } from "@/lib/competitive/types";
import SabotageScreen from "@/components/competitive/sabotage/SabotageScreen";
import ZoomScreen from "@/components/competitive/zoom/ZoomScreen";
import SpectrumScreen from "@/components/competitive/spectrum/SpectrumScreen";
import PinScreen from "@/components/competitive/pin/PinScreen";
import PokerFaceScreen from "@/components/competitive/pokerface/PokerFaceScreen";

export interface MatchPlayer {
  id: string;
  username: string;
  avatar_url: string | null;
  competitive_elo: number;
  squad_elo: number;
}

export interface LoadedMatch {
  match: CompetitiveMatchRow;
  rounds: Record<string, unknown>[];
  players: MatchPlayer[];
  you: string;
}

export default function CompetitiveMatchPage() {
  const params = useParams();
  const { user } = useAuth();
  const mode = String(params?.mode ?? "");
  const matchId = String(params?.matchId ?? "");
  const [loaded, setLoaded] = useState<LoadedMatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    (async () => {
      const { ok, data, error: err } = await apiGet<LoadedMatch>(`/api/competitive/match/${matchId}`);
      if (cancelled) return;
      if (!ok || !data) {
        setError(err || "Could not load match");
        return;
      }
      setLoaded(data);
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  if (!isCompetitiveMode(mode)) {
    return (
      <ProtectedRoute>
        <Shell><p className="text-cream/60">Unknown mode.</p></Shell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <Shell>
        {error && (
          <div className="text-center py-20">
            <p className="text-cream/70 mb-2">{error}</p>
            <p className="text-cream/40 text-sm">This match may have ended or you are not a participant.</p>
          </div>
        )}
        {!error && !loaded && (
          <div className="text-center py-20">
            <span className="inline-block w-3 h-3 rounded-full bg-gold animate-pulse" />
            <p className="text-cream/50 mt-3 font-bebas tracking-wider">LOADING MATCH...</p>
          </div>
        )}
        {!error && loaded && user && (
          <>
            {mode === "sabotage" && <SabotageScreen loaded={loaded} selfId={user.id} />}
            {mode === "zoom" && <ZoomScreen loaded={loaded} selfId={user.id} />}
            {mode === "spectrum" && <SpectrumScreen loaded={loaded} selfId={user.id} />}
            {mode === "pin" && <PinScreen loaded={loaded} selfId={user.id} />}
            {mode === "pokerface" && <PokerFaceScreen loaded={loaded} selfId={user.id} />}
          </>
        )}
      </Shell>
    </ProtectedRoute>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div data-force-dark className="relative min-h-screen pt-16 pb-24 overflow-hidden" style={{ isolation: "isolate" }}>
      <div className="absolute top-[15%] left-[20%] w-[420px] h-[420px] rounded-full pointer-events-none opacity-[0.04]"
        style={{ background: "radial-gradient(circle, #A855F7 0%, transparent 70%)" }} />
      <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <BackButton href="/compete/arena" label="Arena" />
        {children}
      </div>
    </div>
  );
}
