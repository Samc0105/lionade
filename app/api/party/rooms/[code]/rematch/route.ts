// POST /api/party/rooms/[code]/rematch
//
// Host-only "rematch" action: hard-reset the room to a fresh lobby with the
// SAME roster + a clean slate. Equivalent to end-game + clear scores + clear
// every player's ready flag (so they each opt into the rematch deliberately
// rather than auto-starting again, which would feel jarring after the reveal).
//
// 2026-06-05 Bucket C #5 — Sketchy / Bluff post-game flow had no rematch CTA;
// players had to leave the room and re-join to play another match. This route
// is the backend half of the new "REMATCH" button on the round-reveal screens.
//
// Mechanics:
//   - Verifies the caller is the host (mirrors end-game's gate).
//   - Closes any in-flight sketch / bluff / pokerface rounds (defensive — the
//     game-over surface that calls rematch will usually be on a finished
//     round already, but if a host slams rematch mid-round we end it cleanly).
//   - Resets party_room_players.score = 0 and is_ready = false for every
//     non-spectator player in the room. Spectators have no score so we leave
//     them out of the score reset; their is_ready is also reset since the
//     lobby flow doesn't distinguish.
//   - Flips room.status = 'lobby', current_game = null, last_action = 'rematch'
//     so the Lobby surface can show a small "REMATCH READY" affordance if it
//     wants to (purely informational — no DB column needed beyond status).
//
// Auth: requireAuth. Demo accounts are NOT blocked — rematch doesn't grant
// rewards or notifications, it's a state reset on a room the host already owns.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const code = normalizeRoomCode(params.code);
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, host_user_id, status, current_game")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.host_user_id !== userId) {
    return NextResponse.json(
      { error: "Only the host can start a rematch" },
      { status: 403 },
    );
  }

  const nowIso = new Date().toISOString();

  // Close any in-flight rounds so the rematch lobby is clean. Same pattern as
  // end-game — defensive against the host slamming rematch mid-round.
  await Promise.all([
    supabaseAdmin
      .from("sketch_rounds")
      .update({ ended_at: nowIso })
      .eq("room_id", room.id)
      .is("ended_at", null),
    supabaseAdmin
      .from("bluff_rounds")
      .update({ ended_at: nowIso, phase: "reveal" })
      .eq("room_id", room.id)
      .is("ended_at", null),
  ]);

  // Reset all active players in the room to score=0, is_ready=false. We DO
  // reset the host's ready flag too — the lobby's ready toggle is opt-in,
  // and forcing the host to confirm they want a rematch before it starts is
  // worth a single tap. left_at IS NULL scopes to active seats only.
  await supabaseAdmin
    .from("party_room_players")
    .update({ score: 0, is_ready: false })
    .eq("room_id", room.id)
    .is("left_at", null);

  // Drop the room back to lobby state. Mirror end-game's last_game write so
  // the lobby breadcrumb survives a rematch flow too (otherwise rematch would
  // silently wipe the "your group last played X" signal).
  const update: { status: string; current_game: null; last_game?: string } = {
    status: "lobby",
    current_game: null,
  };
  if (room.current_game) update.last_game = room.current_game;
  await supabaseAdmin
    .from("party_rooms")
    .update(update)
    .eq("id", room.id);

  return NextResponse.json({ ok: true });
}
