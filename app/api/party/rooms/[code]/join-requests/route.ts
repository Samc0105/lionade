// GET /api/party/rooms/[code]/join-requests — list pending join requests.
//
// Host-only. Hydrates the RoomLobby's pending-request banner on mount in
// case the host opened the lobby AFTER a broadcast fired (broadcasts are
// fire-and-forget and don't have a replay buffer).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { isEffectiveHost } from "@/lib/party/room-state";

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
    .select("id, host_user_id, status")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) {
    return NextResponse.json({ pending: [] });
  }

  const allowed = await isEffectiveHost(supabaseAdmin, room.id, room.host_user_id, userId);
  if (!allowed) {
    return NextResponse.json({ pending: [] });
  }

  const { data: rows } = await supabaseAdmin
    .from("party_join_requests")
    .select("id, requester_user_id, note, requested_at, profiles!party_join_requests_requester_user_id_fkey(username, avatar_url)")
    .eq("room_code", code)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(3);

  // The FK pointer may not resolve via PostgREST shorthand if the foreign key
  // isn't named exactly that. Fall back to a separate profiles lookup.
  let enriched = (rows ?? []).map((r) => ({
    request_id: r.id,
    requester_user_id: r.requester_user_id,
    note: r.note,
    requested_at: r.requested_at,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requester_name: ((Array.isArray((r as any).profiles) ? (r as any).profiles[0] : (r as any).profiles)?.username) ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requester_avatar: ((Array.isArray((r as any).profiles) ? (r as any).profiles[0] : (r as any).profiles)?.avatar_url) ?? null,
  }));

  // Belt-and-suspenders: if any row missed its profile join, hydrate.
  const missing = enriched.filter((r) => r.requester_name === null).map((r) => r.requester_user_id);
  if (missing.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", missing);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    enriched = enriched.map((r) =>
      r.requester_name === null
        ? {
            ...r,
            requester_name: byId.get(r.requester_user_id)?.username ?? "Player",
            requester_avatar: byId.get(r.requester_user_id)?.avatar_url ?? null,
          }
        : r,
    );
  }

  return NextResponse.json({ pending: enriched });
}
