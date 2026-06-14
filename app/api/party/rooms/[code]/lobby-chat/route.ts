// POST /api/party/rooms/[code]/lobby-chat — post a chat message in the room.
// GET  /api/party/rooms/[code]/lobby-chat — return last 20 messages for hydration.
//
// Auth: requireAuth + caller must be an active member (left_at IS NULL).
// Body: { body: string, client_id?: uuid } 1..200 chars after trim.
// Broadcasts PARTY_EVENTS.LOBBY_CHAT to the room channel with the message
// + sender's username so other clients can render without a fresh fetch.
//
// Perf pass 2026-06-10 — `client_id`: the sender broadcasts the message on
// its own open room channel BEFORE this request lands (near-zero perceived
// latency for roommates) using a client-generated uuid. We insert with that
// uuid as the row id so the server's backstop broadcast + the GET hydration
// carry the SAME id and every client's de-dup-by-id keeps exactly one copy.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";
import { moderateText, logFlagged } from "@/lib/moderation-ugc";

const MAX_BODY = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // Optional client-generated id (see header comment). Ignored unless it's a
  // well-formed uuid, so a malicious value can't poke at the insert.
  const clientId =
    typeof body?.client_id === "string" && UUID_RE.test(body.client_id)
      ? body.client_id.toLowerCase()
      : null;

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

  // Moderate before persisting + broadcasting to the room (lobby chat fans out
  // live to every member). Block + audit on a flag; fail-safe to the denylist.
  const mod = await moderateText(raw);
  if (!mod.ok) {
    void logFlagged(userId, "lobby_chat", raw, mod);
    return NextResponse.json(
      { error: "That message can't be sent. Keep it respectful." },
      { status: 400 },
    );
  }

  // Insert + sender-profile lookup are independent — run them in parallel
  // (each is a Supabase round-trip; sequential was ~2x the latency).
  const [insertRes, profileRes] = await Promise.all([
    supabaseAdmin
      .from("party_lobby_chat")
      .insert({
        room_code: code,
        user_id: userId,
        body: raw,
        ...(clientId ? { id: clientId } : {}),
      })
      .select("id, created_at, body")
      .single(),
    supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  let inserted = insertRes.data;
  const insertErr = insertRes.error;
  const profile = profileRes.data;
  if (insertErr || !inserted) {
    // Retry/replay with the same client_id → unique violation. The message is
    // already persisted; treat as success so the client doesn't roll back.
    // Security: the recovery select is scoped to THIS sender + THIS room —
    // matching on id alone would let any authed member "adopt" (and
    // rebroadcast as their own) a foreign message row whose uuid they know.
    if (clientId && insertErr?.code === "23505") {
      const { data: existingMsg } = await supabaseAdmin
        .from("party_lobby_chat")
        .select("id, created_at, body")
        .eq("id", clientId)
        .eq("user_id", userId)
        .eq("room_code", code)
        .maybeSingle();
      if (existingMsg) {
        inserted = existingMsg;
      } else {
        // Conflicting row exists but belongs to someone else / another room.
        return NextResponse.json(
          { error: "Message id conflict." },
          { status: 409 },
        );
      }
    }
    if (!inserted) {
      console.error("[party/lobby-chat] insert", insertErr?.message);
      return NextResponse.json({ error: "Couldn't send the message." }, { status: 500 });
    }
  }

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
        // Identity here is server-verified (requireAuth + membership check).
        // Client-side LOBBY_CHAT broadcasts on the public room topic carry
        // whatever user_id/user_name the sender claims — clients render those
        // as PENDING until this authoritative copy (same message_id) lands.
        authoritative: true,
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
