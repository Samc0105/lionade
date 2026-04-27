import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

// GET — List friends + pending requests
//
// Performance: the naïve version of this route did ~10 serial DB round-trips
// (per-friend/per-pending profile lookups + sequential friendships/messages
// queries). That's ~1.5-2s on cold cache. This rewrite does everything in
// two parallel waves:
//   Wave 1 (parallel): accepted friendships, incoming pending, outgoing
//                      pending, unread messages
//   Wave 2 (parallel): ONE profiles query for every id collected above
// Net: ~2 logical round-trips regardless of circle size.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    // ── Wave 1: fire the 4 independent queries in parallel ──
    const [acceptedRes, incomingRes, outgoingRes, unreadRes] = await Promise.all([
      supabaseAdmin
        .from("friendships")
        .select("id, user_id, friend_id, status, created_at")
        .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
        .eq("status", "accepted"),
      supabaseAdmin
        .from("friendships")
        .select("id, user_id, created_at")
        .eq("friend_id", userId)
        .eq("status", "pending"),
      supabaseAdmin
        .from("friendships")
        .select("id, friend_id, created_at")
        .eq("user_id", userId)
        .eq("status", "pending"),
      supabaseAdmin
        .from("messages")
        .select("sender_id")
        .eq("receiver_id", userId)
        .eq("read", false),
    ]);

    const acceptedRows = acceptedRes.data ?? [];
    const incomingRows = incomingRes.data ?? [];
    const outgoingRows = outgoingRes.data ?? [];
    const unreadRows = unreadRes.data ?? [];

    // Collect every profile id we need in a single Set so one .in() query
    // covers all three consumer tables.
    const profileIds = new Set<string>();
    for (const f of acceptedRows) {
      profileIds.add(f.user_id === userId ? f.friend_id : f.user_id);
    }
    for (const r of incomingRows) profileIds.add(r.user_id);
    for (const r of outgoingRows) profileIds.add(r.friend_id);

    // ── Wave 2: one combined profile fetch ──
    type Profile = {
      id: string;
      username: string;
      avatar_url: string | null;
      arena_elo: number | null;
      is_online: boolean | null;
      last_seen: string | null;
    };
    const profileMap = new Map<string, Profile>();
    if (profileIds.size > 0) {
      const { data: profileRows } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, arena_elo, is_online, last_seen")
        .in("id", Array.from(profileIds));
      for (const p of (profileRows ?? []) as Profile[]) {
        profileMap.set(p.id, p);
      }
    }

    // Build unread-count map
    const unreadMap: Record<string, number> = {};
    for (const m of unreadRows) {
      unreadMap[m.sender_id] = (unreadMap[m.sender_id] ?? 0) + 1;
    }

    // Shape the response
    const friends = acceptedRows
      .map(f => {
        const otherId = f.user_id === userId ? f.friend_id : f.user_id;
        const p = profileMap.get(otherId);
        if (!p) return null;
        return {
          id: p.id,
          username: p.username,
          avatar_url: p.avatar_url,
          arena_elo: p.arena_elo ?? 1000,
          is_online: p.is_online ?? false,
          last_seen: p.last_seen,
          unreadCount: unreadMap[p.id] ?? 0,
        };
      })
      .filter(Boolean);

    const pendingRequests = incomingRows
      .map(r => {
        const p = profileMap.get(r.user_id);
        if (!p) return null;
        return {
          id: p.id,
          username: p.username,
          avatar_url: p.avatar_url,
          arena_elo: p.arena_elo ?? 1000,
          friendshipId: r.id,
        };
      })
      .filter(Boolean);

    const outgoingRequests = outgoingRows
      .map(r => {
        const p = profileMap.get(r.friend_id);
        if (!p) return null;
        return {
          id: p.id,
          username: p.username,
          avatar_url: p.avatar_url,
          arena_elo: p.arena_elo ?? 1000,
          friendshipId: r.id,
          sentAt: r.created_at,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ friends, pendingRequests, outgoingRequests });
  } catch (e) {
    console.error("[social/friends GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST — Send friend request
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { friendUsername } = await req.json();
    if (!friendUsername) {
      return NextResponse.json({ error: "Missing friendUsername" }, { status: 400 });
    }

    // Sanitize username — strip ilike wildcards, validate shape
    const cleanUsername = String(friendUsername).trim().replace(/[%_]/g, "");
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 });
    }

    // Case-insensitive lookup (wildcards already stripped above)
    const { data: friend } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .ilike("username", cleanUsername)
      .single();

    if (!friend) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (friend.id === userId) return NextResponse.json({ error: "Cannot add yourself" }, { status: 400 });

    // Check if friendship already exists
    const { data: existing } = await supabaseAdmin
      .from("friendships")
      .select("id, status")
      .or(`and(user_id.eq.${userId},friend_id.eq.${friend.id}),and(user_id.eq.${friend.id},friend_id.eq.${userId})`)
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (existing.status === "accepted") return NextResponse.json({ error: "Already friends" }, { status: 400 });
      if (existing.status === "pending") return NextResponse.json({ error: "Request already pending" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("friendships")
      .insert({ user_id: userId, friend_id: friend.id, status: "pending" })
      .select()
      .single();

    if (error) {
      console.error("[social/friends]", error.message);
      return NextResponse.json({ error: "Couldn't load friends." }, { status: 500 });
    }

    // Create notification for the receiver (non-blocking)
    try {
      const { data: senderProfile } = await supabaseAdmin
        .from("profiles").select("username").eq("id", userId).single();
      await supabaseAdmin.from("notifications").insert({
        user_id: friend.id,
        type: "friend_request",
        title: `${senderProfile?.username ?? "Someone"} sent you a friend request`,
        message: "Accept or decline in Social",
        action_url: "/social",
        related_user_id: userId,
      });
    } catch { /* notifications table may not exist yet */ }

    return NextResponse.json({ success: true, friendship: data });
  } catch (e) {
    console.error("[social/friends POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH — Accept or decline friend request
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { friendshipId, action } = await req.json();
    if (!friendshipId || !["accept", "decline"].includes(action)) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { data: friendship } = await supabaseAdmin
      .from("friendships")
      .select("*")
      .eq("id", friendshipId)
      .eq("friend_id", userId)
      .eq("status", "pending")
      .single();

    if (!friendship) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    const newStatus = action === "accept" ? "accepted" : "declined";
    await supabaseAdmin
      .from("friendships")
      .update({ status: newStatus })
      .eq("id", friendshipId);

    // Notify the original requester (non-blocking)
    if (action === "accept") {
      try {
        const { data: acceptorProfile } = await supabaseAdmin
          .from("profiles").select("username").eq("id", userId).single();
        await supabaseAdmin.from("notifications").insert({
          user_id: friendship.user_id,
          type: "friend_accepted",
          title: `${acceptorProfile?.username ?? "Someone"} accepted your friend request`,
          message: "You can now chat and challenge each other",
          action_url: "/social",
          related_user_id: userId,
        });
      } catch { /* notifications table may not exist yet */ }
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (e) {
    console.error("[social/friends PATCH]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE — Cancel an outgoing pending friend request
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const friendshipId = req.nextUrl.searchParams.get("id");
    if (!friendshipId) {
      return NextResponse.json({ error: "Missing id param" }, { status: 400 });
    }

    // Only the sender can cancel their own pending request
    const { data: friendship } = await supabaseAdmin
      .from("friendships")
      .select("*")
      .eq("id", friendshipId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .single();

    if (!friendship) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    await supabaseAdmin
      .from("friendships")
      .delete()
      .eq("id", friendshipId);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[social/friends DELETE]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
