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
//
// VOID / FORFEIT (2026-06): the result is now a discriminated outcome.
//   - "settled"   → a normal win/loss/draw with ELO + Fang deltas.
//   - "voided"    → a side never engaged; /complete returned { voided }. No
//                   ELO/Fang change. The present player gets this when they end
//                   a match an opponent abandoned before ever playing.
//   - "forfeited" → the caller quit a match BOTH sides had engaged in; the
//                   /forfeit endpoint returned { forfeited, result }. The caller
//                   takes the loss. (A forfeit against an opponent who never
//                   engaged comes back as { voided } instead — no penalty.)

import { useState, useCallback } from "react";
import { apiPost } from "@/lib/api-client";

export interface SettleScore {
  winnerTeam: "a" | "b" | "draw";
  scoreA: number;
  scoreB: number;
  eloAfter: Record<string, number>;
  eloDeltas: Record<string, number>;
  fangDelta: Record<string, number>;
  mode: string;
  format: string;
}

// The end-of-match outcome the screens render. A normal settle carries the full
// score payload; a void/forfeit carries only what ResultCard needs to explain
// the no-change (void) or the loss (forfeit) honestly.
export type MatchOutcome =
  | ({ kind: "settled" } & SettleScore)
  | { kind: "voided"; reason?: string }
  | ({ kind: "forfeited" } & SettleScore);

// Back-compat alias — older imports referenced SettleResult as the score shape.
export type SettleResult = SettleScore;

// Server response shapes for the two endpoints we POST to here.
interface CompleteResponse extends Partial<SettleScore> {
  alreadyCompleted?: boolean;
  voided?: boolean;
  reason?: string;
}
interface ForfeitResponse {
  ok?: boolean;
  voided?: boolean;
  forfeited?: boolean;
  reason?: string;
  result?: SettleScore;
}

export function useSettle(matchId: string) {
  const [result, setResult] = useState<MatchOutcome | null>(null);
  const [settling, setSettling] = useState(false);
  // Surfaced when /complete or /forfeit fails (!ok || !data). Without this the
  // screen just silently re-enabled its button and the player was stranded with
  // no idea the request failed. The shell reads this to show an inline retry
  // message instead of a button that appears to do nothing.
  const [error, setError] = useState<string | null>(null);

  // Normal end-of-match settlement (rounds exhausted) AND the path the present
  // player uses to END a match an opponent abandoned. POST /complete may now
  // answer { voided } when a side never played — we surface that as a neutral
  // outcome instead of silently no-oping.
  const settle = useCallback(
    async () => {
      if (settling || result) return;
      setSettling(true);
      setError(null);
      const { ok, data } = await apiPost<CompleteResponse>(
        `/api/competitive/match/${matchId}/complete`,
        {},
      );
      setSettling(false);
      if (!ok || !data) {
        setError("Couldn't end the match, try again");
        return;
      }
      if (data.voided) {
        setResult({ kind: "voided", reason: data.reason });
      } else if (data.winnerTeam) {
        setResult({ kind: "settled", ...(data as SettleScore) });
      }
      // alreadyCompleted with no payload: the opponent settled first. Leave any
      // prior result in place; nothing to show that we don't already have.
    },
    [matchId, settling, result],
  );

  // The PRESENT player chooses to quit. POST /forfeit decides honestly:
  //   - opponent never engaged → { voided } (no penalty to the caller).
  //   - both engaged           → { forfeited, result } (caller takes the loss).
  const forfeit = useCallback(
    async () => {
      if (settling || result) return;
      setSettling(true);
      setError(null);
      const { ok, data } = await apiPost<ForfeitResponse>(
        `/api/competitive/match/${matchId}/forfeit`,
        {},
      );
      setSettling(false);
      if (!ok || !data) {
        setError("Couldn't end the match, try again");
        return;
      }
      if (data.voided) {
        setResult({ kind: "voided", reason: data.reason });
      } else if (data.forfeited && data.result) {
        setResult({ kind: "forfeited", ...data.result });
      }
    },
    [matchId, settling, result],
  );

  return { settle, forfeit, result, settling, error };
}
