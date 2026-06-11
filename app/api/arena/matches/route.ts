// GET /api/arena/matches — the authed user's recent completed arena matches.
//
// Built for the iOS arena lobby's recent-matches strip (shared contract; the
// web lobby can adopt it later). Returns a FLAT per-match shape from the
// caller's perspective:
//
//   { matches: [{
//       id, opponentId, opponentUsername, opponentAvatarUrl,
//       myScore, oppScore, myEloChange, status, createdAt
//   }] }
//
// Notes:
//   - myScore/oppScore are correct-answer counts (arena_matches.player1_score /
//     player2_score — the same columns /api/arena/complete writes).
//   - myEloChange is elo_after - elo_before for the caller's side (0 when the
//     legacy row predates ELO snapshots).
//   - Only status='completed' rows — in-progress matches live in the active
//     match flow, not the history strip.
//   - Rate limiting: covered by the middleware-wide /api/arena/ rule.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

const MATCH_LIMIT = 10;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data: rows, error } = await supabaseAdmin
      .from("arena_matches")
      .select("id, player1_id, player2_id, player1_score, player2_score, player1_elo_before, player2_elo_before, player1_elo_after, player2_elo_after, status, created_at")
      .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(MATCH_LIMIT);

    if (error) {
      console.error("[arena/matches GET]", error.message);
      return NextResponse.json({ error: "Couldn't load matches" }, { status: 500 });
    }

    const matchRows = rows ?? [];

    // One batched profile read for every opponent in the strip.
    const opponentIds = Array.from(
      new Set(
        matchRows.map((m) => (m.player1_id === userId ? m.player2_id : m.player1_id)),
      ),
    );

    const profileMap = new Map<string, { username: string; avatar_url: string | null }>();
    if (opponentIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", opponentIds);
      for (const p of profiles ?? []) {
        profileMap.set(p.id, { username: p.username, avatar_url: p.avatar_url });
      }
    }

    const matches = matchRows.map((m) => {
      const amP1 = m.player1_id === userId;
      const opponentId = amP1 ? m.player2_id : m.player1_id;
      const opp = profileMap.get(opponentId);
      const myEloBefore = (amP1 ? m.player1_elo_before : m.player2_elo_before) ?? null;
      const myEloAfter = (amP1 ? m.player1_elo_after : m.player2_elo_after) ?? null;
      return {
        id: m.id,
        opponentId,
        opponentUsername: opp?.username ?? "Unknown",
        opponentAvatarUrl: opp?.avatar_url ?? null,
        myScore: (amP1 ? m.player1_score : m.player2_score) ?? 0,
        oppScore: (amP1 ? m.player2_score : m.player1_score) ?? 0,
        myEloChange:
          myEloBefore !== null && myEloAfter !== null ? myEloAfter - myEloBefore : 0,
        status: m.status as string,
        createdAt: m.created_at as string,
      };
    });

    return NextResponse.json({ matches });
  } catch (e) {
    console.error("[arena/matches GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
