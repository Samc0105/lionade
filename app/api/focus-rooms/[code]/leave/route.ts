// POST /api/focus-rooms/[code]/leave — quiet leave.
//
// Sets left_at on the member row. Leaving is always penalty-free (no stakes),
// but leaving MID-SESSION forfeits the payout: /complete requires an active
// (left_at IS NULL) membership, and /join blocks rejoins once running.
//
// Lifecycle:
//   - Host leaves a LOBBY with others present -> host transfers to the
//     longest-joined remaining member (party pattern).
//   - Last member leaves a lobby or running room -> room flips to 'expired'
//     (bounded: an empty room is a dead room). done rooms are left alone.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  isValidFocusRoomCode,
  normalizeFocusRoomCode,
} from "@/lib/focus-rooms/room-code";
import {
  isMissingFocusRoomsSchema,
  focusRoomsUnavailableResponse,
} from "@/lib/focus-rooms/schema-guard";
import {
  focusRoomChannel,
  FOCUS_ROOM_EVENTS,
} from "@/lib/focus-rooms/channels";

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const code = normalizeFocusRoomCode(params.code);
  if (!isValidFocusRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const { data: roomRows, error: roomErr } = await supabaseAdmin
    .from("focus_rooms")
    .select("id, host_user_id, status")
    .eq("code", code)
    .order("created_at", { ascending: false })
    .limit(1);
  if (roomErr) {
    if (isMissingFocusRoomsSchema(roomErr)) return focusRoomsUnavailableResponse();
    console.error("[focus-rooms/leave] room lookup", roomErr.message);
    return NextResponse.json({ error: "Couldn't leave the room." }, { status: 500 });
  }
  const room = roomRows?.[0];
  if (!room || room.status === "expired" || room.status === "done") {
    return NextResponse.json({ ok: true, already_over: true });
  }

  const { error: leaveErr } = await supabaseAdmin
    .from("focus_room_members")
    .update({ left_at: new Date().toISOString() })
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .is("left_at", null);
  if (leaveErr) {
    console.error("[focus-rooms/leave] update", leaveErr.message);
    return NextResponse.json({ error: "Couldn't leave the room." }, { status: 500 });
  }

  // Remaining active members.
  const { data: remaining } = await supabaseAdmin
    .from("focus_room_members")
    .select("user_id, joined_at")
    .eq("room_id", room.id)
    .is("left_at", null)
    .order("joined_at", { ascending: true });

  if (!remaining || remaining.length === 0) {
    // Empty room: terminal. Status-guarded so a concurrent /complete's
    // 'done' flip (or a concurrent start) wins over this.
    await supabaseAdmin
      .from("focus_rooms")
      .update({ status: "expired" })
      .eq("id", room.id)
      .in("status", ["lobby", "running"]);
    return NextResponse.json({ ok: true, room_ended: true });
  }

  // Host transfer (lobby only — after start the host has no special powers).
  if (room.status === "lobby" && room.host_user_id === userId) {
    await supabaseAdmin
      .from("focus_rooms")
      .update({ host_user_id: remaining[0].user_id })
      .eq("id", room.id);
  }

  // Server-side broadcast covers every leave path incl. tab-close keepalive.
  const ch = supabaseAdmin.channel(focusRoomChannel(code));
  try {
    await ch.send({
      type: "broadcast",
      event: FOCUS_ROOM_EVENTS.MEMBER_LEFT,
      payload: { user_id: userId },
    });
  } catch (err: unknown) {
    console.warn("[focus-rooms/leave] broadcast warn:", err);
  } finally {
    void supabaseAdmin.removeChannel(ch);
  }

  return NextResponse.json({ ok: true });
}
