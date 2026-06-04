"use client";

// PostRoundVoteCard — shared voting card surfaced on the post-round (reveal)
// screens for Sketchy / Bluff / Poker Face. Non-host players see two big
// buttons:
//   - Play another (vote_kind: "play_again")
//   - Back to lobby (vote_kind: "back_to_lobby")
// Host also sees the tally but retains their gold "Play Again / Lobby" CTAs;
// when the 75% auto-decide threshold lands, the room transitions automatically
// via the `onAutoPlayAgain` / `onAutoBackToLobby` callbacks the parent wires.
//
// Backend already returns `winner: "play_again" | "back_to_lobby"` from the
// vote tally. We poll the votes GET every 3s (kept >=2s per spec) and call
// the appropriate callback exactly ONCE per round when winner first lands.

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { apiGet, apiPost } from "@/lib/api-client";
import type { RoundKind, VoteKind } from "@/lib/party/round-votes";

interface VoteTallyResponse {
  ok: boolean;
  tally: { play_again: number; back_to_lobby: number };
  total_eligible: number;
  total_voted: number;
  threshold_reached: boolean;
  winner: VoteKind | null;
}

interface Props {
  roundId: string;
  roundKind: RoundKind;
  isHost: boolean;
  // Called exactly once when the auto-decide threshold lands. Parent decides
  // what "play again" and "back to lobby" mean for the specific game.
  onAutoPlayAgain: () => void;
  onAutoBackToLobby: () => void;
}

export default function PostRoundVoteCard({
  roundId,
  roundKind,
  isHost,
  onAutoPlayAgain,
  onAutoBackToLobby,
}: Props) {
  const reduced = useReducedMotion();
  const [tally, setTally] = useState<VoteTallyResponse | null>(null);
  const [myVote, setMyVote] = useState<VoteKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One-shot guard so the auto-decide callback only fires once per mount even
  // though we re-poll every 3s. Re-mounting the card (new round) resets it.
  const winnerFiredRef = useRef(false);

  // ── Poll the tally every 3s ──
  // Spec ceiling: don't go below 2s. 3s is the floor we use everywhere else.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await apiGet<VoteTallyResponse>(
        `/api/party/rounds/${roundId}/votes?round_kind=${roundKind}`,
      );
      if (cancelled || !res.ok || !res.data) return;
      setTally(res.data);
      // Fire the auto-transition callback exactly once when the server first
      // reports a winner. Both host and non-host clients can hit this — the
      // host's callback advances the round; the non-host's callback is a no-op
      // wrapper that just clears UI state, since the next round/lobby will
      // arrive via the room channel broadcast.
      if (res.data.winner && !winnerFiredRef.current) {
        winnerFiredRef.current = true;
        if (res.data.winner === "play_again") onAutoPlayAgain();
        else onAutoBackToLobby();
      }
    }
    void load();
    const iv = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [roundId, roundKind, onAutoPlayAgain, onAutoBackToLobby]);

  async function cast(kind: VoteKind) {
    if (submitting) return;
    setSubmitting(true);
    // Optimistic local highlight — the poll catches up within 3s.
    setMyVote(kind);
    const res = await apiPost<VoteTallyResponse>(
      `/api/party/rounds/${roundId}/vote`,
      { vote_kind: kind, round_kind: roundKind },
    );
    setSubmitting(false);
    if (res.ok && res.data) {
      setTally(res.data);
      if (res.data.winner && !winnerFiredRef.current) {
        winnerFiredRef.current = true;
        if (res.data.winner === "play_again") onAutoPlayAgain();
        else onAutoBackToLobby();
      }
    }
  }

  const playAgain = tally?.tally.play_again ?? 0;
  const backToLobby = tally?.tally.back_to_lobby ?? 0;
  const totalVoted = tally?.total_voted ?? 0;
  const totalEligible = tally?.total_eligible ?? 0;

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: "rgba(16,12,26,0.6)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-bebas text-[11px] tracking-[0.25em] text-cream/50">
          VOTE WHAT&apos;S NEXT
        </p>
        <p className="font-syne text-[11px] text-cream/40">
          {totalVoted} of {totalEligible} voted
          {totalEligible > 0 && (
            <>
              {" · "}
              {playAgain} want to play again
            </>
          )}
        </p>
      </div>

      {/* Non-host vote buttons — host sees the tally only (their gold CTAs are
          adjacent in the parent). */}
      {!isHost && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cast("play_again")}
            disabled={submitting}
            className={`py-3 rounded-xl font-bebas text-sm tracking-wider transition-all active:scale-95 disabled:opacity-40 inline-flex items-center justify-center gap-2 ${
              myVote === "play_again" && !reduced ? "pa-pop-in" : ""
            }`}
            style={{
              background:
                myVote === "play_again"
                  ? "linear-gradient(135deg, rgba(34,197,94,0.28) 0%, rgba(22,163,74,0.12) 100%)"
                  : "rgba(34,197,94,0.08)",
              border:
                myVote === "play_again"
                  ? "1px solid rgba(34,197,94,0.6)"
                  : "1px solid rgba(34,197,94,0.3)",
              color: "#86EFAC",
            }}
            aria-label="Vote to play another round"
            aria-pressed={myVote === "play_again"}
          >
            <span aria-hidden="true">{"\u{1F44D}"}</span>
            <span>PLAY ANOTHER</span>
          </button>
          <button
            type="button"
            onClick={() => cast("back_to_lobby")}
            disabled={submitting}
            className={`py-3 rounded-xl font-bebas text-sm tracking-wider transition-all active:scale-95 disabled:opacity-40 inline-flex items-center justify-center gap-2 ${
              myVote === "back_to_lobby" && !reduced ? "pa-pop-in" : ""
            }`}
            style={{
              background:
                myVote === "back_to_lobby"
                  ? "linear-gradient(135deg, rgba(168,85,247,0.28) 0%, rgba(99,102,241,0.12) 100%)"
                  : "rgba(168,85,247,0.08)",
              border:
                myVote === "back_to_lobby"
                  ? "1px solid rgba(168,85,247,0.6)"
                  : "1px solid rgba(168,85,247,0.3)",
              color: "#E9D5FF",
            }}
            aria-label="Vote to return to the lobby"
            aria-pressed={myVote === "back_to_lobby"}
          >
            <span aria-hidden="true">{"\u{1F6AA}"}</span>
            <span>BACK TO LOBBY</span>
          </button>
        </div>
      )}

      {/* Tally bar — both kinds of voters see this. */}
      {totalEligible > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-bebas text-[10px] tracking-wider text-cream/55 w-24 shrink-0">
              PLAY AGAIN
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-cream/[0.07] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${totalEligible > 0 ? (playAgain / totalEligible) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #22C55E, #14B870)",
                  transition: reduced ? "none" : "width 0.5s var(--ease-out-quart)",
                }}
              />
            </div>
            <span className="font-dm-mono text-[11px] text-cream/60 w-8 text-right">
              {playAgain}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bebas text-[10px] tracking-wider text-cream/55 w-24 shrink-0">
              TO LOBBY
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-cream/[0.07] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${totalEligible > 0 ? (backToLobby / totalEligible) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #A855F7, #6366F1)",
                  transition: reduced ? "none" : "width 0.5s var(--ease-out-quart)",
                }}
              />
            </div>
            <span className="font-dm-mono text-[11px] text-cream/60 w-8 text-right">
              {backToLobby}
            </span>
          </div>
        </div>
      )}

      {tally?.threshold_reached && tally?.winner && (
        <p className="font-syne text-[11px] text-cream/55 italic text-center pt-1">
          {tally.winner === "play_again"
            ? "The room voted to play again. Starting the next round..."
            : "The room voted to head back to the lobby."}
        </p>
      )}
      {!tally?.threshold_reached && isHost && (
        <p className="font-syne text-[11px] text-cream/40 italic text-center">
          You can pick now, or wait for the room. 75% auto-decides.
        </p>
      )}
    </div>
  );
}
