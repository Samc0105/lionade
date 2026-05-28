// Competitive platform — match state.
//
// GET /api/competitive/match/[id]
//   Returns the match row plus the per-mode round/hand state and the
//   participant display profiles (username/avatar) so the screen can render
//   without a second round-trip. Auth required; only participants may read the
//   full match (others get 403 — matches aren't public spectator content yet).
//
// SECRET STRIPPING (CRITICAL 1-4 fix): this endpoint is the sanitized serve path
// for in-flight round content. The mode screens render from this payload, so it
// MUST NOT include the round secret until the round has ended. We drop
// correct_index / answer / aliases / true_value / true_lat / true_lng for any
// round whose ended_at is still null, and the entire is_truth/card_fact/claim
// surface for any pokerface hand not yet at reveal/done. The secret reaches a
// player only through the /answer (or /pokerface/call) reveal, after they act.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import type { CompetitiveMatchRow } from "@/lib/competitive/types";

const ROUND_TABLE: Record<string, string> = {
  sabotage: "sabotage_rounds",
  zoom: "zoom_rounds",
  spectrum: "spectrum_rounds",
  pin: "pin_rounds",
  pokerface: "pokerface_hands",
};

// Per-mode secret columns dropped from any round that has not yet ended.
const SECRET_COLUMNS: Record<string, string[]> = {
  sabotage: ["correct_index"],
  zoom: ["answer", "aliases"],
  spectrum: ["true_value"],
  pin: ["true_lat", "true_lng"],
};

type RoundRow = Record<string, unknown>;

/**
 * Strip the round secret from any not-yet-ended row. For the answer-scored modes
 * the secret is gone until ended_at is set (the /answer route sets it once every
 * participant has submitted). For pokerface, hands not at reveal/done lose the
 * truth flag + the curated fact + the (possibly invented) claim text, so a caller
 * can't peek before calling.
 */
function sanitizeRounds(mode: string, rounds: RoundRow[]): RoundRow[] {
  if (mode === "pokerface") {
    return rounds.map((h) => {
      const ended = h.phase === "reveal" || h.phase === "done" || !!h.ended_at;
      if (ended) return h;
      const { is_truth, card_fact, claim_text, ...safe } = h;
      void is_truth; void card_fact; void claim_text;
      return safe;
    });
  }
  const secrets = SECRET_COLUMNS[mode] ?? [];
  if (secrets.length === 0) return rounds;
  return rounds.map((r) => {
    if (r.ended_at) return r;
    const copy = { ...r };
    for (const col of secrets) delete copy[col];
    return copy;
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data: matchRaw } = await supabaseAdmin
      .from("competitive_matches")
      .select("*")
      .eq("id", params.id)
      .single();

    if (!matchRaw) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
    const match = matchRaw as CompetitiveMatchRow;
    const participants = [...match.team_a, ...match.team_b];
    if (!participants.includes(userId)) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }

    const roundTable = ROUND_TABLE[match.mode];
    const orderCol = match.mode === "pokerface" ? "hand_num" : "round_num";
    const { data: rounds } = await supabaseAdmin
      .from(roundTable)
      .select("*")
      .eq("match_id", match.id)
      .order(orderCol, { ascending: true });

    const { data: players } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, competitive_elo, squad_elo")
      .in("id", participants);

    return NextResponse.json({
      match,
      rounds: sanitizeRounds(match.mode, (rounds ?? []) as RoundRow[]),
      players: players ?? [],
      you: userId,
    });
  } catch (e) {
    console.error("[competitive/match GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
