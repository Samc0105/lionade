"use client";

// Shared settlement hook for competitive mode screens.
//
// At the end of a match the screen calls settle() once. settle() POSTs to the
// shared /complete endpoint with an EMPTY body — the server recomputes the
// winner from its own persisted scores (competitive_responses for answer modes,
// the per-hand fang_delta for Poker Face). The client NO LONGER sends a score
// map; the body is ignored server-side (HIGH 5 fix). Idempotent on the server
// (atomic claim), so a double-call from both clients just returns
// alreadyCompleted.

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
    async () => {
      if (settling || result) return;
      setSettling(true);
      const { ok, data } = await apiPost<SettleResult & { alreadyCompleted?: boolean }>(
        `/api/competitive/match/${matchId}/complete`,
        {},
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
