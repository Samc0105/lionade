// POST /api/party/rooms/[code]/ready — toggle the authed user's ready state.
//
// Body (optional): { ready: boolean }. If omitted, server flips the current
// value. Idempotent when explicit.
//
// Returns: { ok, is_ready, all_ready, players_total, players_ready }.
// `all_ready` lets the host's Start button enable/disable without a separate
// query. Realtime subscribers to the room channel pick up the change via
// the postgres_changes feed on party_room_players.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";

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

  // Find the room — must not be ended or already playing.
  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, status")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.status !== "lobby") {
    return NextResponse.json(
      { error: "Ready state can only change in the lobby." },
      { status: 409 },
    );
  }

  // Look up the user's current row.
  const { data: existing } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, is_ready, left_at")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing || existing.left_at) {
    return NextResponse.json(
      { error: "You are not in this room." },
      { status: 403 },
    );
  }

  // Parse optional body for explicit target value; otherwise toggle.
  let target: boolean;
  try {
    const body = (await req.json()) as { ready?: unknown };
    target =
      typeof body?.ready === "boolean" ? body.ready : !existing.is_ready;
  } catch {
    target = !existing.is_ready;
  }

  await supabaseAdmin
    .from("party_room_players")
    .update({ is_ready: target })
    .eq("room_id", room.id)
    .eq("user_id", userId);

  // Re-query the room for the aggregate ready state. Spectators are excluded
  // from the aggregate — they don't play, so they must never hold `all_ready`
  // false (mirrors the start route's gate).
  const { data: allRows } = await supabaseAdmin
    .from("party_room_players")
    .select("is_ready, is_spectator")
    .eq("room_id", room.id)
    .is("left_at", null);

  const participants = (allRows ?? []).filter((r) => !r.is_spectator);
  const total = participants.length;
  const ready = participants.filter((r) => r.is_ready).length;

  return NextResponse.json({
    ok: true,
    is_ready: target,
    all_ready: total > 0 && ready === total,
    players_total: total,
    players_ready: ready,
  });
}
