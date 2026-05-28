// Competitive platform — match state.
//
// GET /api/competitive/match/[id]
//   Returns the match row plus the per-mode round/hand state and the
//   participant display profiles (username/avatar) so the screen can render
//   without a second round-trip. Auth required; only participants may read the
//   full match (others get 403 — matches aren't public spectator content yet).

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
      rounds: rounds ?? [],
      players: players ?? [],
      you: userId,
    });
  } catch (e) {
    console.error("[competitive/match GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
