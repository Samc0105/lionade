// POST /api/party/sketch/rounds/[id]/select-word — drawer locks one of the 3 words.
//
// Body: { word: string }
//
// Writes the chosen word + its factoid onto the round row. Clears the
// in-memory candidate cache so subsequent /words requests return 410.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { readCandidates, clearCandidates } from "@/lib/party/sketch-candidates";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const chosenWord: string | undefined = body?.word;
  if (!chosenWord || typeof chosenWord !== "string") {
    return NextResponse.json({ error: "Missing word" }, { status: 400 });
  }

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select("drawer_user_id, word, room_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.drawer_user_id !== auth.userId) {
    return NextResponse.json({ error: "Only the drawer can pick" }, { status: 403 });
  }
  if (round.word && round.word !== "__pending__") {
    return NextResponse.json({ error: "Word already locked" }, { status: 409 });
  }

  const candidates = readCandidates(params.id) ?? [];
  const match = candidates.find((c) => c.word === chosenWord);
  if (!match) {
    return NextResponse.json({ error: "Word not in candidate set" }, { status: 400 });
  }

  await supabaseAdmin
    .from("sketch_rounds")
    .update({
      word: match.word,
      factoid: match.factoid,
      started_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  clearCandidates(params.id);

  return NextResponse.json({ ok: true, locked: true });
}
