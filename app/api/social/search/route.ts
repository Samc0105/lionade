import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { DEMO_USER_ID } from "@/lib/demo-guard";

export const dynamic = "force-dynamic";

// Relationship of a search result relative to the searching user.
//   none     → no friendship row exists between us
//   incoming → THEY sent ME a pending request (I can Accept)
//   outgoing → I sent THEM a pending request (shows "Requested")
//   friends  → accepted friendship (shows "Friends")
type Relationship = "none" | "incoming" | "outgoing" | "friends";

// GET — Search users by username.
//
// History: this route used to EXCLUDE every user with an existing accepted OR
// pending friendship from results. That hid anyone who had sent you a request,
// so searching for them returned nothing ("search doesn't work"). Now we return
// every match (except self) with a `relationship` field so the UI can render the
// right action (Add / Accept / Requested / Friends). Only self is excluded.
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

    // Build a relationship map for every user I have a friendship row with,
    // in either direction. Used to annotate (not exclude) search results.
    const relById = new Map<string, { relationship: Relationship; friendshipId: string }>();

    const { data: friendships } = await supabaseAdmin
      .from("friendships")
      .select("id, user_id, friend_id, status")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .in("status", ["accepted", "pending"]);

    for (const f of friendships ?? []) {
      const otherId = f.user_id === userId ? f.friend_id : f.user_id;
      let relationship: Relationship;
      if (f.status === "accepted") {
        relationship = "friends";
      } else if (f.user_id === userId) {
        // I am the requester → I sent them a request
        relationship = "outgoing";
      } else {
        // They are the requester (friend_id === me) → they sent me a request
        relationship = "incoming";
      }
      // Prefer an accepted/most-relevant row if multiple exist; "friends" wins.
      const existing = relById.get(otherId);
      if (!existing || relationship === "friends") {
        relById.set(otherId, { relationship, friendshipId: f.id });
      }
    }

    // Exclude the shared demo account from search results so users can't
    // friend-add the demo (it's a publicly-known shared account; adding
    // it to a real friend list would be a useless trophy that everybody
    // shares).
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url, arena_elo")
      .ilike("username", `%${query}%`)
      .neq("id", DEMO_USER_ID)
      // P0 trust-gap fix 2026-06-05: respect server-enforced visibility.
      // Users who set their profile to "private" must not appear in
      // discovery — search is the primary user-finding surface. The
      // pending-friendship relationship map (`relById`) above includes
      // every existing friendship, so a private user with whom the
      // searcher already has a friendship row is still annotated
      // correctly if they ever resurface in another listing — but
      // they don't appear in NEW search results.
      .neq("profile_visibility", "private")
      .limit(10);

    if (error) {
      console.error("[social/search GET]", error.message);
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }

    const users = (data ?? [])
      .filter(u => u.id !== userId) // exclude ONLY self
      .slice(0, 8)
      .map(u => {
        const rel = relById.get(u.id);
        return {
          ...u,
          arena_elo: u.arena_elo ?? 1000,
          relationship: rel?.relationship ?? "none",
          // friendshipId is only meaningful for incoming (Accept) /
          // outgoing requests; null for none/friends.
          friendshipId: rel?.friendshipId ?? null,
        };
      });

    return NextResponse.json({ users });
  } catch (e) {
    console.error("[social/search GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
