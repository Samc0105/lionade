import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET — Search users by username
export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get("q");
    const userId = req.nextUrl.searchParams.get("userId");

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ users: [] });
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, arena_elo")
      .ilike("username", `%${query.trim()}%`)
      .neq("id", userId ?? "")
      .limit(10);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      users: (data ?? []).map(u => ({
        ...u,
        arena_elo: u.arena_elo ?? 1000,
      })),
    });
  } catch (e) {
    console.error("[social/search GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
