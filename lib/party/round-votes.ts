// Shared helpers for the round-end "play again / back to lobby" vote.
//
// One vote row per (round_id, user_id) — second vote from the same user
// overwrites their first via upsert. Auto-decide threshold is 75% of
// eligible voters in the room (active = left_at IS NULL) OR all eligible
// voters have voted.

import type { SupabaseClient } from "@supabase/supabase-js";

export type RoundKind = "sketch" | "bluff" | "pokerface" | "trivia";
export type VoteKind = "play_again" | "back_to_lobby";

export const ROUND_KINDS: RoundKind[] = ["sketch", "bluff", "pokerface", "trivia"];
export const VOTE_KINDS: VoteKind[] = ["play_again", "back_to_lobby"];

export function isRoundKind(v: unknown): v is RoundKind {
  return typeof v === "string" && (ROUND_KINDS as string[]).includes(v);
}
export function isVoteKind(v: unknown): v is VoteKind {
  return typeof v === "string" && (VOTE_KINDS as string[]).includes(v);
}

/** Map round_kind -> round table name. */
const ROUND_TABLE: Record<RoundKind, string> = {
  sketch: "sketch_rounds",
  bluff: "bluff_rounds",
  pokerface: "party_pokerface_rounds",
  trivia: "trivia_rounds",
};

/**
 * Resolve a round id to its room_id + room code. Returns null if not found.
 * Used by both POST /vote and GET /votes to:
 *   1. Verify the round exists
 *   2. Verify the caller is a member of the room
 *   3. Provide the room_code needed for the party_round_votes row.
 */
export async function resolveRoundRoom(
  supabase: SupabaseClient,
  roundId: string,
  roundKind: RoundKind,
): Promise<{ roomId: string; roomCode: string } | null> {
  const table = ROUND_TABLE[roundKind];
  const { data: round } = await supabase
    .from(table)
    .select("room_id")
    .eq("id", roundId)
    .maybeSingle();
  if (!round?.room_id) return null;

  const { data: room } = await supabase
    .from("party_rooms")
    .select("code")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room?.code) return null;

  return { roomId: round.room_id as string, roomCode: room.code as string };
}

export interface VoteTally {
  tally: { play_again: number; back_to_lobby: number };
  total_eligible: number;
  total_voted: number;
  threshold_reached: boolean;
  winner: VoteKind | null;
}

/**
 * Read every vote for this round + count active room members, then derive
 * the tally + threshold state.
 *
 * Threshold rule (per spec):
 *   - If a vote_kind has >=75% of eligible voters, threshold reached, winner=that kind.
 *   - If ALL eligible voters have voted, threshold reached, winner = majority
 *     (ties resolve to play_again — the optimistic default).
 *   - Otherwise threshold not reached, winner = null.
 */
export async function computeTally(
  supabase: SupabaseClient,
  roundId: string,
  roomId: string,
): Promise<VoteTally> {
  const [{ data: votes }, { count: activeCount }] = await Promise.all([
    supabase
      .from("party_round_votes")
      .select("user_id, vote_kind")
      .eq("round_id", roundId),
    supabase
      .from("party_room_players")
      .select("user_id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .is("left_at", null),
  ]);

  let playAgain = 0;
  let backToLobby = 0;
  // Dedupe by user_id defensively (the row has a UNIQUE constraint, but a
  // race with a delete/re-insert could in theory show two rows; keep the
  // last one each).
  const lastByUser = new Map<string, VoteKind>();
  for (const v of votes ?? []) {
    lastByUser.set(v.user_id as string, v.vote_kind as VoteKind);
  }
  lastByUser.forEach((kind) => {
    if (kind === "play_again") playAgain++;
    else if (kind === "back_to_lobby") backToLobby++;
  });

  const totalEligible = Math.max(0, activeCount ?? 0);
  const totalVoted = lastByUser.size;
  const ratioPlayAgain = totalEligible > 0 ? playAgain / totalEligible : 0;
  const ratioBack = totalEligible > 0 ? backToLobby / totalEligible : 0;
  const everyoneVoted = totalEligible > 0 && totalVoted >= totalEligible;

  let winner: VoteKind | null = null;
  let thresholdReached = false;
  if (ratioPlayAgain >= 0.75) {
    winner = "play_again";
    thresholdReached = true;
  } else if (ratioBack >= 0.75) {
    winner = "back_to_lobby";
    thresholdReached = true;
  } else if (everyoneVoted) {
    thresholdReached = true;
    if (playAgain >= backToLobby) winner = "play_again";
    else winner = "back_to_lobby";
  }

  return {
    tally: { play_again: playAgain, back_to_lobby: backToLobby },
    total_eligible: totalEligible,
    total_voted: totalVoted,
    threshold_reached: thresholdReached,
    winner,
  };
}
