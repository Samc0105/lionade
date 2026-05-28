// GET /api/party/sketch/rounds/[id]/words — drawer fetches their 3 candidate words.
//
// Returns 403 to anyone other than the round's drawer so guessers can't peek.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { readCandidates } from "@/lib/party/sketch-candidates";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select("drawer_user_id, word")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.drawer_user_id !== auth.userId) {
    return NextResponse.json({ error: "Only the drawer can see candidate words" }, { status: 403 });
  }
  if (round.word && round.word !== "__pending__") {
    // Drawer already picked. Return the locked word.
    return NextResponse.json({ locked: true, word: round.word });
  }

  const candidates = readCandidates(params.id);
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ error: "No candidates available" }, { status: 410 });
  }
  return NextResponse.json({
    candidates: candidates.map((c) => ({
      word: c.word,
      difficulty: c.difficulty,
      // factoid kept server-side until round end; drawer doesn't need it.
    })),
  });
}
