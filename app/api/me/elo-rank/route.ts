import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Returns just the caller's ELO rank — no full leaderboard scan needed.
 * Counts profiles with strictly greater elo, +1.
 *
 *   GET /api/me/elo-rank → { elo: number, rank: number, totalRanked: number }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: me } = await supabaseAdmin
    .from("profiles").select("arena_elo").eq("id", userId).maybeSingle();
  const elo = me?.arena_elo ?? null;
  if (elo === null) return NextResponse.json({ elo: null, rank: null, totalRanked: 0 });

  // Two parallel counts: how many people are strictly ahead, total ranked pool.
  const [aheadRes, totalRes] = await Promise.all([
    supabaseAdmin.from("profiles")
      .select("id", { count: "exact", head: true })
      .gt("arena_elo", elo),
    supabaseAdmin.from("profiles")
      .select("id", { count: "exact", head: true })
      .not("arena_elo", "is", null),
  ]);

  return NextResponse.json({
    elo,
    rank: (aheadRes.count ?? 0) + 1,
    totalRanked: totalRes.count ?? 0,
  });
}
