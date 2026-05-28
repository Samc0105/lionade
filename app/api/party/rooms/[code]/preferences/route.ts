// POST /api/party/rooms/[code]/preferences — set the authed user's selected
// subjects for this room. Cap of 2 picks per player; subjects beyond the
// allowed set are silently dropped server-side. Idempotent — replace, not
// append.
//
// Body: { subjects: string[] } — array of subject ids (e.g. ["biology", "math"])
// Response: { ok, selected_subjects: string[] }
//
// The sketch round word-picker weights subjects by overlap across all
// active players' selections — a subject picked by 4 players is 4x as
// likely to surface as one picked by 1.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";

const ALLOWED_SUBJECTS = new Set([
  "biology",
  "chemistry",
  "physics",
  "math",
  "history",
  "geography",
  "astronomy",
  "pop-culture",
]);
const MAX_PICKS = 2;

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
    .select("id, status")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Parse body. Reject non-array; clamp to MAX_PICKS; filter to allowed list.
  let raw: unknown[] = [];
  try {
    const body = (await req.json()) as { subjects?: unknown };
    if (Array.isArray(body?.subjects)) raw = body.subjects;
  } catch {
    /* fall through with empty raw */
  }

  const cleaned = Array.from(
    new Set(
      raw
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.toLowerCase())
        .filter((s) => ALLOWED_SUBJECTS.has(s)),
    ),
  ).slice(0, MAX_PICKS);

  // Confirm caller is in the room.
  const { data: existing } = await supabaseAdmin
    .from("party_room_players")
    .select("user_id, left_at")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing || existing.left_at) {
    return NextResponse.json({ error: "You are not in this room." }, { status: 403 });
  }

  await supabaseAdmin
    .from("party_room_players")
    .update({ selected_subjects: cleaned })
    .eq("room_id", room.id)
    .eq("user_id", userId);

  return NextResponse.json({ ok: true, selected_subjects: cleaned });
}
