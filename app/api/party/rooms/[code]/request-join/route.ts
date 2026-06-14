// POST /api/party/rooms/[code]/request-join — request to join a privacy-gated room.
// GET  /api/party/rooms/[code]/request-join — caller's latest request status (polled
//   by the request-to-join modal on the /games/party landing page).
//
// Anti-spam: 1 pending request per (user, room) at any time, max 3 pending
// requests across all rooms per user, 5-minute floor between attempts on
// the same room.
//
// Broadcasts PARTY_EVENTS.JOIN_REQUEST to the main room channel with the
// requester's username + avatar + optional note. The host's RoomLobby
// listens and surfaces an accept/decline banner.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";
import { moderateText, logFlagged } from "@/lib/moderation-ugc";

const REQUEST_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_PENDING_PER_USER = 3;

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

  const body = await req.json().catch(() => ({}));
  const rawNote = typeof body?.note === "string" ? body.note.trim() : "";
  const note = rawNote.length > 0 ? rawNote.slice(0, 50) : null;

  // Moderate the optional note — it's broadcast to the room host's accept/
  // decline banner. Block + audit on a flag (mirrors lobby-chat).
  if (note) {
    const mod = await moderateText(note);
    if (!mod.ok) {
      void logFlagged(userId, "join_request_note", note, mod);
      return NextResponse.json(
        { error: "That message can't be sent. Keep it respectful." },
        { status: 400 },
      );
    }
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, host_user_id, status, dismissed_at")
    .eq("code", code)
    .neq("status", "ended")
    .is("dismissed_at", null)
    .maybeSingle();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.host_user_id === userId) {
    return NextResponse.json({ error: "You're the host of this room." }, { status: 400 });
  }

  // Already an active member? Skip the request flow entirely.
  const { data: existingMembership } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (existingMembership) {
    return NextResponse.json({ ok: true, already_member: true });
  }

  // Anti-spam guard: pending request for this room?
  const { data: pendingForRoom } = await supabaseAdmin
    .from("party_join_requests")
    .select("id, requested_at, status")
    .eq("room_code", code)
    .eq("requester_user_id", userId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingForRoom) {
    return NextResponse.json({ ok: true, request_id: pendingForRoom.id, already_pending: true });
  }

  // Cooldown: last attempt in last 5 min for this room (any status).
  const cutoff = new Date(Date.now() - REQUEST_COOLDOWN_MS).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("party_join_requests")
    .select("id, requested_at")
    .eq("room_code", code)
    .eq("requester_user_id", userId)
    .gte("requested_at", cutoff)
    .limit(1);
  if (recent && recent.length > 0) {
    return NextResponse.json(
      { error: "You just tried this room. Wait a few minutes." },
      { status: 429 },
    );
  }

  // Cap on total pending requests across all rooms.
  const { count: pendingCount } = await supabaseAdmin
    .from("party_join_requests")
    .select("id", { count: "exact", head: true })
    .eq("requester_user_id", userId)
    .eq("status", "pending");
  if ((pendingCount ?? 0) >= MAX_PENDING_PER_USER) {
    return NextResponse.json(
      { error: "Too many pending join requests. Wait for one to clear." },
      { status: 429 },
    );
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("party_join_requests")
    .insert({ room_code: code, requester_user_id: userId, note })
    .select("id, requested_at, note")
    .single();
  if (insertErr || !inserted) {
    console.error("[party/request-join] insert", insertErr?.message);
    return NextResponse.json({ error: "Couldn't send the request." }, { status: 500 });
  }

  // Hydrate username + avatar for the host's banner payload.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("username, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  const ch = supabaseAdmin.channel(roomChannel(code));
  try {
    await ch.send({
      type: "broadcast",
      event: PARTY_EVENTS.JOIN_REQUEST,
      payload: {
        request_id: inserted.id,
        requester_user_id: userId,
        requester_name: profile?.username ?? "Player",
        requester_avatar: profile?.avatar_url ?? null,
        note: inserted.note,
      },
    });
  } catch (err) {
    console.warn("[party/request-join] broadcast warn:", err);
  } finally {
    void supabaseAdmin.removeChannel(ch);
  }

  return NextResponse.json({ ok: true, request_id: inserted.id, status: "pending" });
}

// GET — return the caller's latest request status for this room.
export async function GET(
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

  const { data } = await supabaseAdmin
    .from("party_join_requests")
    .select("id, status, requested_at, decided_at, note")
    .eq("room_code", code)
    .eq("requester_user_id", userId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ status: "none" });
  }

  return NextResponse.json({
    request_id: data.id,
    status: data.status,
    requested_at: data.requested_at,
    decided_at: data.decided_at,
    note: data.note,
  });
}
