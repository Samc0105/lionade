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
import {
  isBankToken,
  parseBankToken,
  bankToken,
  filterEligibleOwnedBanks,
} from "@/lib/party/sketch-bank-source";

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
// A player may pick up to 2 SOURCES total — curated subjects and Word Banks
// combined. (A "bank:<uuid>" token counts the same as a bare subject.)
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

  // First pass: collect the candidate bank uuids so we can validate them all
  // in one batch (ownership + word-count) before building the final list.
  const bankIds: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && isBankToken(item)) {
      const id = parseBankToken(item);
      if (id) bankIds.push(id);
    }
  }

  // Validate bank tokens: keep only banks OWNED by the caller with enough words.
  const eligibleBanks =
    bankIds.length > 0
      ? await filterEligibleOwnedBanks(supabaseAdmin, userId, bankIds)
      : new Set<string>();

  // Build the cleaned list in the caller's original order, deduped, dropping
  // disallowed subjects + ineligible bank tokens, then cap at MAX_PICKS
  // (subjects + banks combined).
  const cleaned: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    let tok: string | null = null;
    if (isBankToken(item)) {
      const id = parseBankToken(item);
      if (id && eligibleBanks.has(id)) tok = bankToken(id);
    } else {
      const subj = item.toLowerCase();
      if (ALLOWED_SUBJECTS.has(subj)) tok = subj;
    }
    if (!tok || cleaned.includes(tok)) continue;
    cleaned.push(tok);
    if (cleaned.length >= MAX_PICKS) break;
  }

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
