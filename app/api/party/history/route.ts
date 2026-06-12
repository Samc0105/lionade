// GET /api/party/history — Past Lobbies for the calling user.
//
// Returns three buckets:
//   active  — rooms the user is currently active in (left_at is null, not ended,
//             not dismissed). One row per room.
//   recent  — rooms the user has been a member of in the last 14 days (max 50).
//   saved   — user-starred rooms. Deferred until party_saved_rooms exists;
//             always [] for now so the client can keep the section in the UI.
//
// Auth: requireAuth.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isLobbyExpired, type ExpirableRoomFields } from "@/lib/party/lobby-expiry";

type RoomStatus = "lobby" | "playing" | "ended";

interface HistoryRow {
  room_id: string;
  room_code: string;
  display_name: string | null;
  game_type: string | null;
  status: RoomStatus;
  members_count: number;
  last_activity_at: string;
  joined_at: string;
  left_at: string | null;
  is_dismissed: boolean;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Pull every room I've been a member of in the last 14 days.
  const { data: memberships, error } = await supabaseAdmin
    .from("party_room_players")
    .select(
      "room_id, joined_at, left_at, party_rooms!inner(id, code, display_name, status, current_game, last_game, created_at, ended_at, dismissed_at)",
    )
    .eq("user_id", userId)
    .gte("joined_at", fourteenDaysAgo)
    .order("joined_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[party/history] memberships query", error.message);
    return NextResponse.json(
      { active: [], recent: [], saved: [] },
      { status: 200 },
    );
  }

  type RoomShape = {
    id: string;
    code: string;
    display_name: string | null;
    status: RoomStatus;
    current_game: string | null;
    last_game: string | null;
    created_at: string;
    ended_at: string | null;
    dismissed_at: string | null;
  };

  // De-dupe by room_id (a user can have multiple membership rows over time
  // if they left + rejoined). Keep the most recent membership per room.
  // metaByRoom keeps the raw room fields the lobby-expiry rule needs — the
  // shaped HistoryRow deliberately drops them from the response.
  const byRoom = new Map<string, HistoryRow>();
  const metaByRoom = new Map<string, ExpirableRoomFields>();
  for (const m of memberships ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawRoom = Array.isArray((m as any).party_rooms)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((m as any).party_rooms[0] as RoomShape | undefined)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : ((m as any).party_rooms as RoomShape | undefined);
    if (!rawRoom) continue;
    const existing = byRoom.get(rawRoom.id);
    if (existing && new Date(existing.joined_at).getTime() >= new Date(m.joined_at).getTime()) {
      continue;
    }
    metaByRoom.set(rawRoom.id, {
      id: rawRoom.id,
      status: rawRoom.status,
      current_game: rawRoom.current_game,
      last_game: rawRoom.last_game,
      created_at: rawRoom.created_at,
      dismissed_at: rawRoom.dismissed_at,
    });
    byRoom.set(rawRoom.id, {
      room_id: rawRoom.id,
      room_code: rawRoom.code,
      display_name: rawRoom.display_name ?? null,
      game_type: rawRoom.current_game ?? rawRoom.last_game ?? null,
      status: rawRoom.status,
      members_count: 0,
      last_activity_at: rawRoom.ended_at ?? rawRoom.created_at,
      joined_at: m.joined_at,
      left_at: m.left_at ?? null,
      is_dismissed: !!rawRoom.dismissed_at,
    });
  }

  if (byRoom.size === 0) {
    return NextResponse.json({ active: [], recent: [], saved: [] });
  }

  // Hydrate members_count for the listed rooms (active membership tally) and
  // each room's most recent joined_at (ALL rows, left players included) for
  // the lobby-expiry rule. One query serves both — previously this fetched
  // only left_at IS NULL rows; the active filter now happens in the loop.
  const roomIds = Array.from(byRoom.keys());
  const { data: tallies } = await supabaseAdmin
    .from("party_room_players")
    .select("room_id, joined_at, left_at")
    .in("room_id", roomIds);

  const tallyMap = new Map<string, number>();
  const lastJoinMap = new Map<string, string>();
  for (const t of tallies ?? []) {
    if (t.left_at === null) {
      tallyMap.set(t.room_id, (tallyMap.get(t.room_id) ?? 0) + 1);
    }
    const prev = lastJoinMap.get(t.room_id);
    if (!prev || new Date(t.joined_at).getTime() > new Date(prev).getTime()) {
      lastJoinMap.set(t.room_id, t.joined_at);
    }
  }
  byRoom.forEach((row) => {
    row.members_count = tallyMap.get(row.room_id) ?? 0;
  });

  // ── Lazy lobby expiry (2026-06-12) ──
  // Hide abandoned lobbies: still status='lobby', never played a game, and no
  // join activity for 5+ hours. Rooms that reached 'playing' or 'ended' stay
  // in history regardless. Filtered here in JS rather than SQL because the
  // rule needs the per-room MAX(joined_at) aggregate across ALL players,
  // which PostgREST's embedded-query grammar can't express (or= can't mix
  // parent + embedded columns either) — and the membership rows are already
  // in hand from the tally query above, so this costs no extra round trip.
  const nowMs = Date.now();
  const all: HistoryRow[] = [];
  byRoom.forEach((row) => {
    const meta = metaByRoom.get(row.room_id);
    if (meta && isLobbyExpired(meta, lastJoinMap.get(row.room_id) ?? null, nowMs)) return;
    all.push(row);
  });

  // Active: I haven't left, room isn't ended, room isn't dismissed.
  const active = all.filter(
    (r) => r.left_at === null && r.status !== "ended" && !r.is_dismissed,
  );
  // Recent: everything else, surfaced descending by joined_at.
  const recent = all
    .filter((r) => !(r.left_at === null && r.status !== "ended" && !r.is_dismissed))
    .sort((a, b) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime());

  return NextResponse.json({
    active,
    recent,
    saved: [],
  });
}
