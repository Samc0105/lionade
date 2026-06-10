// GET /api/party/rooms/[code]/banks — the caller's OWN Word Banks, for the
// Sketchy Subjects source picker.
//
// Returns every bank OWNED by the authed caller (not public banks from others),
// with a word count and an `eligible` flag (wordCount >= MIN_BANK_WORDS). The
// client uses this to render the "use a Word Bank" option in the lobby; only
// eligible banks may actually be picked (preferences route enforces the same
// floor server-side).
//
// Response: { banks: Array<{ id, name, kind, icon, color, wordCount, eligible }> }
// Sorted eligible-desc, then name. Caller MUST be a member of the room.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";
import { isRoomMember } from "@/lib/party/room-state";
import { MIN_BANK_WORDS } from "@/lib/party/sketch-bank-source";

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
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Caller must be in the room before we expose their bank list.
  const isMember = await isRoomMember(supabaseAdmin, room.id, userId);
  if (!isMember) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // Owned banks only — ownership gate in route logic (supabaseAdmin bypasses RLS).
  const { data: banks, error } = await supabaseAdmin
    .from("vocab_banks")
    .select("id, name, kind, icon, color")
    .eq("user_id", userId);
  if (error) {
    console.error("[party/rooms/banks]", error.message);
    return NextResponse.json({ error: "Couldn't load your Word Banks" }, { status: 500 });
  }

  // Word count per bank. A grouped count via PostgREST isn't available without
  // an RPC, so we issue one head-count per owned bank. Bank counts per user are
  // small (single digits) so this is cheap.
  const rows = banks ?? [];
  const counts = await Promise.all(
    rows.map(async (b) => {
      const { count } = await supabaseAdmin
        .from("vocab_words")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("bank_id", b.id);
      return { id: b.id as string, wordCount: count ?? 0 };
    }),
  );
  const countById = new Map(counts.map((c) => [c.id, c.wordCount]));

  const mapped = rows.map((b) => {
    const wordCount = countById.get(b.id as string) ?? 0;
    return {
      id: b.id as string,
      name: b.name as string,
      kind: b.kind as string,
      // vocab_banks.icon is nullable; coerce to a default so the client's
      // PartyBank.icon: string contract holds and we never render a null.
      icon: (b.icon as string | null) ?? "📚",
      color: b.color as string,
      wordCount,
      eligible: wordCount >= MIN_BANK_WORDS,
    };
  });

  // Eligible banks first, then alphabetical by name.
  mapped.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ banks: mapped });
}
