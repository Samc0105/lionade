// POST /api/party/pokerface/rounds — deal a new Poker Face round.
//
// Body: { code: string }
//
// Behavior:
//   - Verify caller is in the room and room.current_game === 'pokerface'.
//   - Pick the PRESENTER by rotation: cycle through the active players ordered by
//     joined_at, advancing one seat each round (round 1 = seat 0, round 2 = seat
//     1, ...). This guarantees everyone presents before anyone repeats.
//   - Deal a card SERVER-SIDE (card_word + card_fact), avoiding words already
//     used this room session. card_fact is the secret truth — it is stored but
//     NEVER returned here; the presenter learns the fact via the presenter-gated
//     GET round route. claim_text + is_lie are null until the presenter presents.
//   - Insert the party_pokerface_rounds row in phase='present'.
//
// Server-authoritative: the presenter is chosen by the server (never trusted from
// the client), the card is drawn server-side, and the secret fact stays in the
// row (read only via the sanitized GET route or after reveal — RLS enforces this
// per migration 056). No Fang wager, no ELO: this is a pure-points party game.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { drawRandomCard } from "@/lib/party/pokerface-cards";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { isRoomMember } from "@/lib/party/room-state";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const code = normalizeRoomCode(body?.code ?? "");
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, current_game")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.current_game !== "pokerface") {
    return NextResponse.json({ error: "Room is not playing Poker Face" }, { status: 400 });
  }

  const isMember = await isRoomMember(supabaseAdmin, room.id, userId);
  if (!isMember) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // Active players, ordered by join time, drive the presenter rotation.
  const { data: activePlayers } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, joined_at")
    .eq("room_id", room.id)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  const seats = (activePlayers ?? []).map((p) => p.user_id);
  if (seats.length < 3) {
    return NextResponse.json({ error: "Poker Face needs at least 3 players" }, { status: 400 });
  }

  // Round number + presenter rotation (round N -> seat (N-1) % seats.length).
  const { data: prev } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .select("round_num, card_word")
    .eq("room_id", room.id)
    .order("round_num", { ascending: false });
  const nextRoundNum = (prev?.[0]?.round_num ?? 0) + 1;
  const presenterId = seats[(nextRoundNum - 1) % seats.length];

  // Avoid repeating a card already drawn this room session.
  const usedWords = (prev ?? []).map((r) => r.card_word).filter(Boolean) as string[];
  const card = drawRandomCard(usedWords);

  const { data: round, error } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .insert({
      room_id: room.id,
      round_num: nextRoundNum,
      presenter_user_id: presenterId,
      card_word: card.word,
      card_fact: card.fact,   // SECRET — never returned by this route
      claim_text: null,
      is_lie: null,
      phase: "present",
    })
    .select("id, room_id, round_num, presenter_user_id, card_word, phase, started_at")
    .single();
  if (error || !round) {
    console.error("[party/pokerface/rounds] insert", error?.message);
    return NextResponse.json({ error: "Couldn't deal a round" }, { status: 500 });
  }

  // Public payload: round id + presenter + the WORD (not the fact, not the lie).
  return NextResponse.json({
    round: {
      id: round.id,
      room_id: round.room_id,
      round_num: round.round_num,
      presenter_user_id: round.presenter_user_id,
      card_word: round.card_word,
      phase: round.phase,
      started_at: round.started_at,
    },
  });
}
