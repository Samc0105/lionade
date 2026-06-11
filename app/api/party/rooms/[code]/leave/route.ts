// POST /api/party/rooms/[code]/leave — mark the authed user as having left.
//
// Sets left_at on their party_room_players row. If they were the host AND the
// room is in lobby AND another active player remains, the host is transferred
// to the next player in joined_at order. If no players remain, the room is
// marked ended.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { clearActiveSession } from "@/lib/presence";
import { roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";

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

  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, host_user_id, status")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) {
    void clearActiveSession(userId);
    return NextResponse.json({ ok: true, already_ended: true });
  }

  await supabaseAdmin
    .from("party_room_players")
    .update({ left_at: new Date().toISOString() })
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .is("left_at", null);

  // Drop their active_session pin regardless of host-transfer outcome below.
  // Fire-and-forget — leave response must not block on presence bookkeeping.
  void clearActiveSession(userId);

  // Find remaining active players.
  const { data: remaining } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, joined_at")
    .eq("room_id", room.id)
    .is("left_at", null)
    .order("joined_at", { ascending: true });

  if (!remaining || remaining.length === 0) {
    // Room is empty: end it.
    await supabaseAdmin
      .from("party_rooms")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", room.id);
    return NextResponse.json({ ok: true, room_ended: true });
  }

  // Host transfer if the leaver was host.
  if (room.host_user_id === userId) {
    const newHost = remaining[0].user_id;
    await supabaseAdmin
      .from("party_rooms")
      .update({ host_user_id: newHost })
      .eq("id", room.id);
  }

  // ── Broadcast PLAYER_LEFT (server-side, join-route pattern) ──
  // Connectivity audit 2026-06-11: the explicit leave button used to be the
  // ONLY path that broadcast (client-side, from the leaving tab). The two
  // other leave paths — tab-close (pagehide fetch keepalive hits this route
  // with no JS left alive to broadcast) and any future server-side reap —
  // were poll-only, so the room learned about a departure up to 3s late.
  // Broadcasting here covers every caller. Best-effort: a broadcast failure
  // never fails the leave; the page's 3s poll stays the reconciler.
  const ch = supabaseAdmin.channel(roomChannel(code));
  try {
    await ch.send({
      type: "broadcast",
      event: PARTY_EVENTS.PLAYER_LEFT,
      payload: { user_id: userId },
    });
  } catch (err: unknown) {
    console.warn("[party/leave] broadcast warn:", err);
  } finally {
    void supabaseAdmin.removeChannel(ch);
  }

  return NextResponse.json({ ok: true });
}
