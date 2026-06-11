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
import { scorePokerFaceRound } from "@/lib/party/pokerface-advance";
import { isEffectiveHost } from "@/lib/party/room-state";

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
  // Accept the stored host OR the deterministic effective host (longest-
  // connected active player) so a host-disconnect can't deadlock the reveal.
  const allowed = await isEffectiveHost(supabaseAdmin, round.room_id, room.host_user_id, userId);
  if (!allowed) {
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

  // ── Server-authoritative scoring (shared helper — same math the reveal GET
  // lazy-advance uses, so banked == displayed, including the caught-red-handed
  // penalty). Single-sourced in lib/party/pokerface-advance.ts. Only this CAS
  // winner reaches here (the `claimed` guard above flipped phase vote->reveal),
  // so deltas are applied exactly once — no double-count. ──
  await scorePokerFaceRound(supabaseAdmin, round);

  return NextResponse.json({ ok: true, phase: "reveal" });
}
