// POST /api/party/rooms — create a new Lionade Party room.
//
// Behavior:
//   - Generate a unique 6-char alphanumeric code.
//   - Insert a `party_rooms` row owned by the authed user.
//   - Insert the host as the first `party_room_players` member.
//   - Apply caller-provided settings (subjects, rounds_per_player, etc.).
//   - Return the new room snapshot + code.
//
// Auth: requireAuth (bearer token). userId always read from verified token,
// never from request body.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { generateUniqueRoomCode } from "@/lib/party/room-code";
import { fetchRoomSnapshot } from "@/lib/party/room-state";

const ALLOWED_SUBJECTS = new Set([
  "biology",
  "chemistry",
  "physics",
  "math",
  "history",
  "geography",
  "astronomy",
  "pop-culture",
]);

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json().catch(() => ({}));
    const rawSubjects: unknown = body?.subjects;
    const subjects = Array.isArray(rawSubjects)
      ? (rawSubjects as unknown[]).filter(
          (s): s is string => typeof s === "string" && ALLOWED_SUBJECTS.has(s),
        )
      : Array.from(ALLOWED_SUBJECTS);
    const roundsPerPlayer =
      typeof body?.rounds_per_player === "number"
        ? Math.max(1, Math.min(5, Math.floor(body.rounds_per_player)))
        : 2;
    const bluffRoundCount =
      typeof body?.bluff_round_count === "number"
        ? Math.max(3, Math.min(10, Math.floor(body.bluff_round_count)))
        : 5;

    const code = await generateUniqueRoomCode(supabaseAdmin);

    const { data: room, error: roomErr } = await supabaseAdmin
      .from("party_rooms")
      .insert({
        code,
        host_user_id: userId,
        status: "lobby",
        current_game: null,
        settings: {
          subjects: subjects.length > 0 ? subjects : Array.from(ALLOWED_SUBJECTS),
          rounds_per_player: roundsPerPlayer,
          bluff_round_count: bluffRoundCount,
          write_seconds: 45,
          vote_seconds: 30,
        },
      })
      .select()
      .single();

    if (roomErr || !room) {
      console.error("[party/rooms] insert room", roomErr?.message);
      return NextResponse.json({ error: "Couldn't create room" }, { status: 500 });
    }

    // Insert host as the first player.
    const { error: playerErr } = await supabaseAdmin
      .from("party_room_players")
      .insert({ room_id: room.id, user_id: userId, score: 0 });
    if (playerErr) {
      console.error("[party/rooms] insert host player", playerErr.message);
    }

    const snapshot = await fetchRoomSnapshot(supabaseAdmin, code);
    return NextResponse.json({
      code,
      room: snapshot?.room ?? room,
      players: snapshot?.players ?? [],
    });
  } catch (e) {
    console.error("[party/rooms]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
