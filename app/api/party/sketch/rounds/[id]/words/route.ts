// GET /api/party/sketch/rounds/[id]/words — drawer fetches their 3 candidate words.
//
// Returns 403 to anyone other than the round's drawer so guessers can't peek.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { readCandidates } from "@/lib/party/sketch-candidates";
import type { WordEntry } from "@/lib/party/word-lists-stub";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  // Read candidate_words from the round row (migration 058). The previous
  // per-process in-memory cache was unreliable on Vercel serverless and is
  // kept only as a fallback for any in-flight pre-058 round.
  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select("drawer_user_id, word, candidate_words")
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

  const fromRow: WordEntry[] | undefined = Array.isArray(round.candidate_words)
    ? (round.candidate_words as WordEntry[])
    : undefined;
  const candidates = fromRow && fromRow.length > 0 ? fromRow : readCandidates(params.id);
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ error: "No candidates available" }, { status: 410 });
  }
  return NextResponse.json({
    candidates: candidates.map((c) => ({
      word: c.word,
      difficulty: c.difficulty,
      // Drawer-only endpoint (403 for everyone else), so it's safe to hand the
      // drawer the factoid here — it powers the "i" info popover on the picker.
      // Guessers never hit this route, so nothing leaks.
      factoid: c.factoid,
    })),
  });
}
