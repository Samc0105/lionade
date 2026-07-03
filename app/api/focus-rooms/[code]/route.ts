// GET /api/focus-rooms/[code] — room snapshot (the room page's poll target).
//
// Returns { room, members, serverNow, isMember, isHost }. serverNow lets the
// client measure its clock skew so the shared countdown derives from the
// SERVER'S ends_at, drift-tolerant (FocusLockIn pattern, but server-anchored).
//
// Lazy lifecycle enforcement on read (party pattern):
//   - lobby idle 5h+  -> flipped to 'expired', answered 410.
//   - running past ends_at -> flipped to 'done' (status-guarded) so abandoned
//     rooms terminate without a cron and every poller sees the summary state.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  isValidFocusRoomCode,
  normalizeFocusRoomCode,
} from "@/lib/focus-rooms/room-code";
import { fetchFocusRoomSnapshot } from "@/lib/focus-rooms/room-state";
import {
  checkFocusLobbyExpired,
  expireFocusLobby,
  FOCUS_ROOM_EXPIRED_MESSAGE,
} from "@/lib/focus-rooms/expiry";
import {
  isMissingFocusRoomsSchema,
  focusRoomsUnavailableResponse,
} from "@/lib/focus-rooms/schema-guard";

export async function GET(
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

  const { snapshot, error } = await fetchFocusRoomSnapshot(supabaseAdmin, code);
  if (error) {
    if (isMissingFocusRoomsSchema(error)) return focusRoomsUnavailableResponse();
    console.error("[focus-rooms/code GET]", (error as { message?: string })?.message);
    return NextResponse.json({ error: "Couldn't load the room." }, { status: 500 });
  }
  if (!snapshot) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const { room, members } = snapshot;

  // Terminal: expired rooms answer 410 with honest copy.
  if (room.status === "expired") {
    return NextResponse.json(
      { error: FOCUS_ROOM_EXPIRED_MESSAGE, expired: true },
      { status: 410 },
    );
  }

  // Lazy lobby expiry (5h, party pattern).
  if (room.status === "lobby" && (await checkFocusLobbyExpired(supabaseAdmin, room))) {
    await expireFocusLobby(supabaseAdmin, room.id);
    return NextResponse.json(
      { error: FOCUS_ROOM_EXPIRED_MESSAGE, expired: true },
      { status: 410 },
    );
  }

  // Running past ends_at: the session is over. Flip to 'done' (status-guarded;
  // /complete also does this) so the room terminates even if nobody claims.
  if (
    room.status === "running" &&
    room.ends_at &&
    Date.now() >= new Date(room.ends_at).getTime()
  ) {
    await supabaseAdmin
      .from("focus_rooms")
      .update({ status: "done" })
      .eq("id", room.id)
      .eq("status", "running");
    room.status = "done";
  }

  const me = members.find((mm) => mm.user_id === userId);

  return NextResponse.json({
    room,
    members,
    serverNow: new Date().toISOString(),
    isMember: !!me && me.left_at === null,
    isHost: room.host_user_id === userId,
  });
}
