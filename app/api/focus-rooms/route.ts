// Focus Rooms — create + "my active room".
//
// POST /api/focus-rooms
//   Body: { durationMinutes: 25 | 45 | 60, privacyMode?: "open"|"friends"|"closed" }
//   Creates a room (4-digit code, party generator pattern), inserts the host
//   as the first member, returns { code, room, members }.
//
// GET /api/focus-rooms
//   Returns { activeRoom } — the caller's most recent lobby/running membership
//   (or null), so the hub page can offer a "rejoin" card.
//
// Joining costs nothing; no stakes. Money only ever moves in /complete.
//
// FAIL-SOFT: while the HELD migration 20260702110000 is unapplied, the tables
// don't exist. GET answers 200 { activeRoom: null, unavailable: true } and
// POST answers the canonical 503 so the UI self-disables with honest copy.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { assertFeatureLive } from "@/lib/feature-flags";
import { generateUniqueFocusRoomCode } from "@/lib/focus-rooms/room-code";
import { fetchFocusRoomSnapshot } from "@/lib/focus-rooms/room-state";
import {
  FOCUS_ROOM_DURATIONS,
  FOCUS_PRIVACY_MODES,
  type FocusRoomDuration,
  type FocusRoomPrivacy,
} from "@/lib/focus-rooms/constants";
import {
  isMissingFocusRoomsSchema,
  focusRoomsUnavailableResponse,
} from "@/lib/focus-rooms/schema-guard";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data, error } = await supabaseAdmin
    .from("focus_room_members")
    .select("room_id, joined_at, focus_rooms!inner(code, status, privacy_mode, duration_minutes, started_at, ends_at)")
    .eq("user_id", userId)
    .is("left_at", null)
    .in("focus_rooms.status", ["lobby", "running"])
    .order("joined_at", { ascending: false })
    .limit(1);

  if (error) {
    if (isMissingFocusRoomsSchema(error)) {
      // Feature not live yet — the hub renders a quiet disabled state.
      return NextResponse.json({ activeRoom: null, unavailable: true });
    }
    console.error("[focus-rooms GET]", error.message);
    return NextResponse.json({ error: "Couldn't load your rooms." }, { status: 500 });
  }

  const row = data?.[0] as
    | { room_id: string; focus_rooms: unknown }
    | undefined;
  if (!row) return NextResponse.json({ activeRoom: null });

  const roomRaw = Array.isArray(row.focus_rooms) ? row.focus_rooms[0] : row.focus_rooms;
  const room = roomRaw as {
    code: string;
    status: string;
    privacy_mode: string;
    duration_minutes: number;
    started_at: string | null;
    ends_at: string | null;
  } | null;
  if (!room) return NextResponse.json({ activeRoom: null });

  return NextResponse.json({
    activeRoom: {
      code: room.code,
      status: room.status,
      privacy_mode: room.privacy_mode,
      duration_minutes: room.duration_minutes,
      started_at: room.started_at,
      ends_at: room.ends_at,
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const m = await assertFeatureLive("focus_rooms");
  if (m) return m;

  const body = await req.json().catch(() => ({}));

  const duration = Number(body?.durationMinutes);
  if (!FOCUS_ROOM_DURATIONS.includes(duration as FocusRoomDuration)) {
    return NextResponse.json(
      { error: `Duration must be one of ${FOCUS_ROOM_DURATIONS.join(", ")} minutes.` },
      { status: 400 },
    );
  }

  const rawPrivacy = typeof body?.privacyMode === "string" ? body.privacyMode : "friends";
  const privacyMode: FocusRoomPrivacy = (FOCUS_PRIVACY_MODES as readonly string[]).includes(rawPrivacy)
    ? (rawPrivacy as FocusRoomPrivacy)
    : "friends";

  try {
    // Two attempts: two concurrent creates can draw the same code (both pass
    // the generator's pre-check); the partial unique index rejects the loser
    // with 23505, and one fresh draw resolves it.
    let room: { id: string; code: string } | null = null;
    let code = "";
    for (let attempt = 0; attempt < 2 && !room; attempt++) {
      code = await generateUniqueFocusRoomCode(supabaseAdmin);
      const { data, error: roomErr } = await supabaseAdmin
        .from("focus_rooms")
        .insert({
          code,
          host_user_id: userId,
          privacy_mode: privacyMode,
          duration_minutes: duration,
          status: "lobby",
        })
        .select("id, code")
        .single();
      if (data) {
        room = data;
        break;
      }
      if (isMissingFocusRoomsSchema(roomErr)) return focusRoomsUnavailableResponse();
      if (roomErr?.code === "23505" && attempt === 0) continue; // code race: redraw
      console.error("[focus-rooms POST] insert room", roomErr?.message);
      return NextResponse.json({ error: "Couldn't create the room." }, { status: 500 });
    }
    if (!room) {
      return NextResponse.json({ error: "Couldn't create the room." }, { status: 500 });
    }

    const { error: memberErr } = await supabaseAdmin
      .from("focus_room_members")
      .insert({ room_id: room.id, user_id: userId });
    if (memberErr) {
      console.error("[focus-rooms POST] insert host member", memberErr.message);
    }

    const { snapshot } = await fetchFocusRoomSnapshot(supabaseAdmin, code);
    return NextResponse.json({
      ok: true,
      code,
      room: snapshot?.room ?? null,
      members: snapshot?.members ?? [],
    });
  } catch (e) {
    console.error("[focus-rooms POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
