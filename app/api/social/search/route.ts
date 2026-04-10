import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET — Search users by username, excluding self + existing friends/pending
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const rawQuery = req.nextUrl.searchParams.get("q") ?? "";
    // Strip ilike wildcards from user input to prevent enumeration attacks
    const query = rawQuery.trim().replace(/[%_\\]/g, "").slice(0, 32);

    if (query.length < 2) {
      return NextResponse.json({ users: [] });
    }

    // Get IDs to exclude: existing friends + pending requests (both directions)
    const excludeIds: string[] = [userId];

    const { data: friendships } = await supabaseAdmin
      .from("friendships")
      .select("user_id, friend_id")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .in("status", ["accepted", "pending"]);

    for (const f of friendships ?? []) {
      const otherId = f.user_id === userId ? f.friend_id : f.user_id;
      if (!excludeIds.includes(otherId)) excludeIds.push(otherId);
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, arena_elo")
      .ilike("username", `%${query}%`)
      .limit(10);

    if (error) {
      console.error("[social/search GET]", error.message);
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }

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
