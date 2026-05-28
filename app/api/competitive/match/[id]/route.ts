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
// round whose ended_at is still null. The secret reaches a player only through
// the /answer reveal, after they act.
//
// (Poker Face was moved to Lionade Party as a no-Fang party game on 2026-05-28
// and is no longer a competitive mode — its hand-secret stripping now lives in
// app/api/party/pokerface/rounds/[id]/route.ts.)

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import type { CompetitiveMatchRow } from "@/lib/competitive/types";

const ROUND_TABLE: Record<string, string> = {
  sabotage: "sabotage_rounds",
  zoom: "zoom_rounds",
  spectrum: "spectrum_rounds",
  pin: "pin_rounds",
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
 * participant has submitted).
 */
function sanitizeRounds(mode: string, rounds: RoundRow[]): RoundRow[] {
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
    const orderCol = "round_num";
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
