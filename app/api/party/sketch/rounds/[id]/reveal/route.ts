// GET /api/party/sketch/rounds/[id]/reveal — guesser-facing word structure +
// the room-wide set of already-revealed (green) letter positions.
//
// SECURITY: returns the structural MASK (length + punctuation only) and the
// positions that have ALREADY been matched by some guesser, each paired with
// the letter that was matched (already public knowledge — a guesser typed it).
// It NEVER returns the secret word or any unmatched letter. Drawers get the
// real word through the drawer-gated /words route, not here.
//
// Used by guesser clients on mount / round-refresh to render the collaborative
// progressive reveal (live updates arrive via the realtime LETTER_REVEAL
// broadcast; this is the catch-up/replay fetch for late joiners).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { buildWordMask } from "@/lib/party/letter-reveal";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select("id, word, drawer_user_id, ended_at")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  // Word not yet locked — no mask to give.
  if (!round.word || round.word === "__pending__") {
    return NextResponse.json({ mask: [], revealed: [] });
  }

  const mask = buildWordMask(round.word);

  const { data: revealedRows } = await supabaseAdmin
    .from("sketch_revealed_positions")
    .select("position, letter")
    .eq("round_id", round.id)
    .order("position", { ascending: true });

  return NextResponse.json({
    mask,
    revealed: (revealedRows ?? []).map((r) => ({ position: r.position, letter: r.letter })),
  });
}
