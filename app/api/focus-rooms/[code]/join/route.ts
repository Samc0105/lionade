// POST /api/focus-rooms/[code]/join — add the authed user to a focus room.
//
// Privacy enforcement copied from the party join route
// (app/api/party/rooms/[code]/join/route.ts):
//   open    -> join
//   friends -> only when the caller is friends with any active member
//   closed  -> nobody new joins (host shares a fresh room instead)
//
// Focus-specific rules:
//   - Join is LOBBY-ONLY. Once the session is running, a non-member can't
//     slip in and claim pay for a partial sit, and a member who left can't
//     rejoin to un-forfeit. Active members re-hitting join while running
//     just get an ok (idempotent re-entry for a re-opened tab).
//   - Joining costs nothing; no stakes.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  isValidFocusRoomCode,
  normalizeFocusRoomCode,
} from "@/lib/focus-rooms/room-code";
import { fetchFocusRoomSnapshot } from "@/lib/focus-rooms/room-state";
import { MAX_ROOM_MEMBERS } from "@/lib/focus-rooms/constants";
import {
  checkFocusLobbyExpired,
  expireFocusLobby,
  FOCUS_ROOM_EXPIRED_MESSAGE,
} from "@/lib/focus-rooms/expiry";
import {
  isMissingFocusRoomsSchema,
  focusRoomsUnavailableResponse,
} from "@/lib/focus-rooms/schema-guard";
import {
  focusRoomChannel,
  FOCUS_ROOM_EVENTS,
} from "@/lib/focus-rooms/channels";

async function isFriendOfAnyActiveMember(roomId: string, userId: string): Promise<boolean> {
  const { data: activeMembers } = await supabaseAdmin
    .from("focus_room_members")
    .select("user_id")
    .eq("room_id", roomId)
    .is("left_at", null);
  const memberIds = (activeMembers ?? []).map((m) => m.user_id).filter((id) => id !== userId);
  if (memberIds.length === 0) return false;
  const { data: friendships } = await supabaseAdmin
    .from("friendships")
    .select("user_id, friend_id, status")
    .eq("status", "accepted")
    .or(`and(user_id.eq.${userId},friend_id.in.(${memberIds.join(",")})),and(friend_id.eq.${userId},user_id.in.(${memberIds.join(",")}))`);
  return (friendships ?? []).length > 0;
}

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

  // Most-recent room for the code (codes recycle after done/expired).
  const { data: roomRows, error: roomErr } = await supabaseAdmin
    .from("focus_rooms")
    .select("id, code, status, host_user_id, privacy_mode, duration_minutes, created_at")
    .eq("code", code)
    .order("created_at", { ascending: false })
    .limit(1);
  if (roomErr) {
    if (isMissingFocusRoomsSchema(roomErr)) return focusRoomsUnavailableResponse();
    console.error("[focus-rooms/join] room lookup", roomErr.message);
    return NextResponse.json({ error: "Couldn't join the room." }, { status: 500 });
  }
  const room = roomRows?.[0];
  if (!room || room.status === "expired") {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.status === "done") {
    return NextResponse.json(
      { error: "That session already wrapped. Start a fresh room." },
      { status: 410 },
    );
  }

  // Lazy 5h lobby expiry BEFORE membership/privacy checks (party pattern).
  if (await checkFocusLobbyExpired(supabaseAdmin, room)) {
    await expireFocusLobby(supabaseAdmin, room.id);
    return NextResponse.json(
      { error: FOCUS_ROOM_EXPIRED_MESSAGE, expired: true },
      { status: 410 },
    );
  }

  // Active count + the caller's existing row, in parallel (party pattern).
  const [{ count }, { data: existing, error: existingErr }] = await Promise.all([
    supabaseAdmin
      .from("focus_room_members")
      .select("user_id", { count: "exact", head: true })
      .eq("room_id", room.id)
      .is("left_at", null),
    supabaseAdmin
      .from("focus_room_members")
      .select("user_id, left_at")
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (existingErr) {
    console.error("[focus-rooms/join] existing-row check", existingErr.message);
    return NextResponse.json({ error: "Couldn't join the room." }, { status: 500 });
  }

  // Already an active member: idempotent ok (re-opened tab, invite re-click).
  if (existing && existing.left_at === null) {
    const { snapshot } = await fetchFocusRoomSnapshot(supabaseAdmin, code);
    return NextResponse.json({
      ok: true,
      already_member: true,
      code,
      room: snapshot?.room ?? null,
      members: snapshot?.members ?? [],
    });
  }

  // Everyone else can only enter (or re-enter) during the lobby.
  if (room.status !== "lobby") {
    return NextResponse.json(
      { error: "This session already started. Catch the next one." },
      { status: 409 },
    );
  }

  if ((count ?? 0) >= MAX_ROOM_MEMBERS) {
    return NextResponse.json({ error: "Room is full" }, { status: 409 });
  }

  // Privacy gate (host always passes; party enforcement incl. friendships).
  const privacy = room.privacy_mode ?? "friends";
  if (privacy !== "open" && room.host_user_id !== userId) {
    if (privacy === "closed") {
      return NextResponse.json(
        { error: "This room is closed. Ask the host to start an open one." },
        { status: 403 },
      );
    }
    const allowed = await isFriendOfAnyActiveMember(room.id, userId);
    if (!allowed) {
      return NextResponse.json(
        { error: "This room is friends only. Add someone in it first." },
        { status: 403 },
      );
    }
  }

  // Upsert, not bare insert: two concurrent first-joins both read existing=null;
  // onConflict resolves the (room_id, user_id) PK race idempotently (party fix).
  const { error: upsertErr } = await supabaseAdmin.from("focus_room_members").upsert(
    {
      room_id: room.id,
      user_id: userId,
      joined_at: new Date().toISOString(),
      left_at: null,
      completed: false,
      bonus_granted: false,
    },
    { onConflict: "room_id,user_id" },
  );
  if (upsertErr) {
    console.error("[focus-rooms/join] upsert", upsertErr.message);
    return NextResponse.json({ error: "Couldn't join the room." }, { status: 500 });
  }

  // Server-side broadcast so the host's lobby reflects the join instantly.
  // Best-effort: a broadcast failure never fails the join (party pattern).
  const ch = supabaseAdmin.channel(focusRoomChannel(code));
  const broadcastP = ch
    .send({
      type: "broadcast",
      event: FOCUS_ROOM_EVENTS.MEMBER_JOINED,
      payload: { user_id: userId },
    })
    .catch((err: unknown) => {
      console.warn("[focus-rooms/join] broadcast warn:", err);
    })
    .finally(() => {
      void supabaseAdmin.removeChannel(ch);
    });

  const [{ snapshot }] = await Promise.all([
    fetchFocusRoomSnapshot(supabaseAdmin, code),
    broadcastP,
  ]);
  return NextResponse.json({
    ok: true,
    code,
    room: snapshot?.room ?? null,
    members: snapshot?.members ?? [],
  });
}
