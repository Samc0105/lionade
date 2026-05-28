// POST /api/party/pokerface/rounds/[id]/complete — reveal + score the hand.
//
// Body: {}   // nothing trusted from the body — scoring is server-authoritative.
//
// Only the HOST of the room may complete a round (the client also auto-fires this
// once the call window elapses; the host call is the authoritative fallback).
//
// Scoring matrix (NO ELO, NO Fang wager — pure points to party_room_players):
//   For each caller's call:
//     correct read (doubt a lie, or believe a truth) → caller +CORRECT_CALL_POINTS
//     wrong read   (believe a lie, or doubt a truth)  → presenter +FOOL_POINTS
//   The presenter banks FOOL_POINTS for every caller they fooled; callers bank
//   CORRECT_CALL_POINTS each for a correct read. Scores are computed ONLY from the
//   server-persisted is_lie + the persisted calls — the client cannot submit a
//   score. We then advance phase -> 'reveal' and set ended_at.
//
// Idempotent: completing an already-revealed round is a no-op (scores are not
// re-applied), mirroring the bluff /complete guard.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  POKERFACE_FOOL_POINTS,
  POKERFACE_CORRECT_CALL_POINTS,
} from "@/lib/party/scoring";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: round } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .select("id, room_id, presenter_user_id, phase, is_lie")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("host_user_id")
    .eq("id", round.room_id)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.host_user_id !== userId) {
    return NextResponse.json({ error: "Only the host can reveal the round" }, { status: 403 });
  }

  // Already revealed → no-op (don't double-apply scores).
  if (round.phase === "reveal") {
    return NextResponse.json({ ok: true, phase: "reveal", alreadyRevealed: true });
  }
  // A round can only be revealed after it was presented (is_lie committed).
  if (round.is_lie === null || round.is_lie === undefined) {
    return NextResponse.json({ error: "The presenter hasn't presented yet" }, { status: 409 });
  }

  // ── Atomic phase claim: vote -> reveal (race guard) ──
  const { data: claimed } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .update({ phase: "reveal", ended_at: new Date().toISOString() })
    .eq("id", round.id)
    .eq("phase", "vote")
    .select("id")
    .maybeSingle();
  if (!claimed) {
    // Someone else just revealed it (or it wasn't in vote). No double-score.
    return NextResponse.json({ ok: true, phase: "reveal", alreadyRevealed: true });
  }

  // ── Server-authoritative scoring ──
  const isLie = round.is_lie === true;
  const { data: calls } = await supabaseAdmin
    .from("party_pokerface_votes")
    .select("voter_user_id, call")
    .eq("round_id", round.id);

  const deltas = new Map<string, number>();
  for (const c of calls ?? []) {
    const correct = (c.call === "doubt" && isLie) || (c.call === "believe" && !isLie);
    if (correct) {
      deltas.set(
        c.voter_user_id,
        (deltas.get(c.voter_user_id) ?? 0) + POKERFACE_CORRECT_CALL_POINTS,
      );
    } else {
      deltas.set(
        round.presenter_user_id,
        (deltas.get(round.presenter_user_id) ?? 0) + POKERFACE_FOOL_POINTS,
      );
    }
  }

  // Apply deltas to party_room_players.score (read-modify-write per player,
  // matching the bluff scoring path).
  for (const [uid, delta] of Array.from(deltas.entries())) {
    if (delta === 0) continue;
    const { data: row } = await supabaseAdmin
      .from("party_room_players")
      .select("score")
      .eq("room_id", round.room_id)
      .eq("user_id", uid)
      .maybeSingle();
    if (!row) continue;
    await supabaseAdmin
      .from("party_room_players")
      .update({ score: (row.score ?? 0) + delta })
      .eq("room_id", round.room_id)
      .eq("user_id", uid);
  }

  return NextResponse.json({ ok: true, phase: "reveal" });
}
