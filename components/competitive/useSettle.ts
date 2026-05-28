"use client";

// Shared settlement hook for competitive mode screens.
//
// Each mode accumulates a per-user raw score during play, then calls settle()
// once at the end. settle() POSTs the score map to the shared /complete endpoint
// which computes winner + ELO + Fang deltas + loss cap, and returns the result
// the screen renders. Idempotent on the server (atomic claim), so a double-call
// from both clients just returns alreadyCompleted.

import { useState, useCallback } from "react";
import { apiPost } from "@/lib/api-client";

export interface SettleResult {
  winnerTeam: "a" | "b" | "draw";
  scoreA: number;
  scoreB: number;
  eloAfter: Record<string, number>;
  eloDeltas: Record<string, number>;
  fangDelta: Record<string, number>;
  mode: string;
  format: string;
}

export function useSettle(matchId: string) {
  const [result, setResult] = useState<SettleResult | null>(null);
  const [settling, setSettling] = useState(false);

  const settle = useCallback(
    async (scores: Record<string, number>) => {
      if (settling || result) return;
      setSettling(true);
      const { ok, data } = await apiPost<SettleResult & { alreadyCompleted?: boolean }>(
        `/api/competitive/match/${matchId}/complete`,
        { scores },
      );
      setSettling(false);
      if (ok && data && data.winnerTeam) {
        setResult(data as SettleResult);
      } else if (ok && data?.alreadyCompleted) {
        // Opponent settled first — refetch isn't necessary; mark a neutral done.
        setResult((prev) => prev ?? null);
      }
    },
    [matchId, settling, result],
  );

  return { settle, result, settling };
}
