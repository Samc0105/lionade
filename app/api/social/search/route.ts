import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// GET — Search users by username, excluding self + existing friends/pending
export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get("q");
    const userId = req.nextUrl.searchParams.get("userId");

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ users: [] });
    }

    // Get IDs to exclude: existing friends + pending requests (both directions)
    const excludeIds: string[] = [userId ?? ""];

    if (userId) {
      const { data: friendships } = await supabaseAdmin
        .from("friendships")
        .select("user_id, friend_id")
        .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
        .in("status", ["accepted", "pending"]);

      for (const f of friendships ?? []) {
        const otherId = f.user_id === userId ? f.friend_id : f.user_id;
        if (!excludeIds.includes(otherId)) excludeIds.push(otherId);
      }
    }

    let dbQuery = supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, arena_elo")
      .ilike("username", `%${query.trim()}%`)
      .limit(10);

    // Supabase doesn't support .not().in() cleanly, so filter in JS
    const { data, error } = await dbQuery;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const filtered = (data ?? [])
      .filter(u => !excludeIds.includes(u.id))
      .slice(0, 8)
      .map(u => ({ ...u, arena_elo: u.arena_elo ?? 1000 }));

    return NextResponse.json({ users: filtered });
  } catch (e) {
    console.error("[social/search GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
