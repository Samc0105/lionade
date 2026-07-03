// POST /api/focus-rooms/[code]/start — HOST kicks off the one shared session.
//
// started_at and ends_at are stamped SERVER-SIDE from the room's stored
// duration — the client never supplies timing, so the payout window in
// /complete can trust ends_at absolutely. Status-guarded lobby->running
// update makes a double-tap (or two hosts racing after a transfer) a no-op.

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
    .select("id, host_user_id, status, duration_minutes")
    .eq("code", code)
    .order("created_at", { ascending: false })
    .limit(1);
  if (roomErr) {
    if (isMissingFocusRoomsSchema(roomErr)) return focusRoomsUnavailableResponse();
    console.error("[focus-rooms/start] room lookup", roomErr.message);
    return NextResponse.json({ error: "Couldn't start the session." }, { status: 500 });
  }
  const room = roomRows?.[0];
  if (!room || room.status === "expired") {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.host_user_id !== userId) {
    return NextResponse.json({ error: "Only the host can start the session." }, { status: 403 });
  }
  if (room.status !== "lobby") {
    return NextResponse.json(
      { error: "This session already started." },
      { status: 409 },
    );
  }

  // The caller must still be an active member (a host who left then hits
  // start from a stale tab shouldn't be able to fire a ghost session).
  const { data: hostMember } = await supabaseAdmin
    .from("focus_room_members")
    .select("user_id")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (!hostMember) {
    return NextResponse.json({ error: "You're not in this room." }, { status: 403 });
  }

  const now = Date.now();
  const startedAt = new Date(now).toISOString();
  const endsAt = new Date(now + room.duration_minutes * 60_000).toISOString();

  const { data: updated, error: startErr } = await supabaseAdmin
    .from("focus_rooms")
    .update({ status: "running", started_at: startedAt, ends_at: endsAt })
    .eq("id", room.id)
    .eq("status", "lobby")
    .select("id");
  if (startErr) {
    console.error("[focus-rooms/start] update", startErr.message);
    return NextResponse.json({ error: "Couldn't start the session." }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    // Lost the guard race — someone else already started it. Idempotent ok.
    return NextResponse.json({ ok: true, already_started: true });
  }

  // Broadcast so every lobby flips to the shared countdown immediately
  // (the postgres_changes feed + 3s poll are the reconciler).
  const ch = supabaseAdmin.channel(focusRoomChannel(code));
  try {
    await ch.send({
      type: "broadcast",
      event: FOCUS_ROOM_EVENTS.SESSION_STARTED,
      payload: { started_at: startedAt, ends_at: endsAt },
    });
  } catch (err: unknown) {
    console.warn("[focus-rooms/start] broadcast warn:", err);
  } finally {
    void supabaseAdmin.removeChannel(ch);
  }

  return NextResponse.json({
    ok: true,
    started_at: startedAt,
    ends_at: endsAt,
    serverNow: new Date().toISOString(),
  });
}
