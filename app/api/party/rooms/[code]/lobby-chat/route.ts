// POST /api/party/rooms/[code]/lobby-chat — post a chat message in the room.
// GET  /api/party/rooms/[code]/lobby-chat — return last 20 messages for hydration.
//
// Auth: requireAuth + caller must be an active member (left_at IS NULL).
// Body: { body: string } 1..200 chars after trim.
// Broadcasts PARTY_EVENTS.LOBBY_CHAT to the room channel with the message
// + sender's username so other clients can render without a fresh fetch.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";

const MAX_BODY = 200;

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
  const raw = typeof body?.body === "string" ? body.body.trim() : "";
  if (raw.length === 0 || raw.length > MAX_BODY) {
    return NextResponse.json({ error: "Message must be 1-200 characters." }, { status: 400 });
  }

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, status")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const { data: member } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "You must be in the room to chat." }, { status: 403 });
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("party_lobby_chat")
    .insert({ room_code: code, user_id: userId, body: raw })
    .select("id, created_at, body")
    .single();
  if (insertErr || !inserted) {
    console.error("[party/lobby-chat] insert", insertErr?.message);
    return NextResponse.json({ error: "Couldn't send the message." }, { status: 500 });
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();

  const ch = supabaseAdmin.channel(roomChannel(code));
  try {
    await ch.send({
      type: "broadcast",
      event: PARTY_EVENTS.LOBBY_CHAT,
      payload: {
        message_id: inserted.id,
        user_id: userId,
        user_name: profile?.username ?? "Player",
        body: inserted.body,
        created_at: inserted.created_at,
      },
    });
  } catch (err) {
    console.warn("[party/lobby-chat] broadcast warn:", err);
  } finally {
    void supabaseAdmin.removeChannel(ch);
  }

  return NextResponse.json({
    ok: true,
    message: {
      id: inserted.id,
      user_id: userId,
      user_name: profile?.username ?? null,
      body: inserted.body,
      created_at: inserted.created_at,
    },
  });
}

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

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) {
    return NextResponse.json({ messages: [] });
  }
  const { data: member } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: rows } = await supabaseAdmin
    .from("party_lobby_chat")
    .select("id, user_id, body, created_at, profiles!inner(username)")
    .eq("room_code", code)
    .order("created_at", { ascending: false })
    .limit(20);

  const messages = (rows ?? [])
    .map((r) => ({
      id: r.id,
      user_id: r.user_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user_name: (Array.isArray((r as any).profiles)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (r as any).profiles[0]?.username
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : (r as any).profiles?.username) ?? null,
      body: r.body,
      created_at: r.created_at,
    }))
    .reverse();

  return NextResponse.json({ messages });
}
