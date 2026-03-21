import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET — List friends + pending requests
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

    // Get accepted friendships
    const { data: friendships } = await supabaseAdmin
      .from("friendships")
      .select("id, user_id, friend_id, status, created_at")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq("status", "accepted");

    // Get friend profile data
    const friendIds = (friendships ?? []).map(f =>
      f.user_id === userId ? f.friend_id : f.user_id
    );

    let friends: {
      id: string;
      username: string;
      avatar_url: string | null;
      arena_elo: number;
      is_online: boolean;
      last_seen: string | null;
    }[] = [];

    if (friendIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, arena_elo, is_online, last_seen")
        .in("id", friendIds);
      friends = (data ?? []).map(p => ({
        ...p,
        arena_elo: p.arena_elo ?? 1000,
        is_online: p.is_online ?? false,
      }));
    }

    // Get unread message counts per friend
    const { data: unreadCounts } = await supabaseAdmin
      .from("messages")
      .select("sender_id")
      .eq("receiver_id", userId)
      .eq("read", false);

    const unreadMap: Record<string, number> = {};
    for (const m of unreadCounts ?? []) {
      unreadMap[m.sender_id] = (unreadMap[m.sender_id] ?? 0) + 1;
    }

    // Get pending incoming requests
    const { data: incoming } = await supabaseAdmin
      .from("friendships")
      .select("id, user_id, created_at")
      .eq("friend_id", userId)
      .eq("status", "pending");

    const pendingProfiles = [];
    for (const req of incoming ?? []) {
      const { data: p } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, arena_elo")
        .eq("id", req.user_id)
        .single();
      if (p) pendingProfiles.push({ ...p, friendshipId: req.id, arena_elo: p.arena_elo ?? 1000 });
    }

    return NextResponse.json({
      friends: friends.map(f => ({
        ...f,
        unreadCount: unreadMap[f.id] ?? 0,
      })),
      pendingRequests: pendingProfiles,
    });
  } catch (e) {
    console.error("[social/friends GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST — Send friend request
export async function POST(req: NextRequest) {
  try {
    const { userId, friendUsername } = await req.json();
    if (!userId || !friendUsername) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Look up friend
    const { data: friend } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .ilike("username", friendUsername.trim())
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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Get sender username for notification
    const { data: senderProfile } = await supabaseAdmin
      .from("profiles").select("username").eq("id", userId).single();

    // Create notification for the receiver
    await supabaseAdmin.from("notifications").insert({
      user_id: friend.id,
      type: "friend_request",
      title: `${senderProfile?.username ?? "Someone"} sent you a friend request`,
      message: "Accept or decline in Social",
      action_url: "/social",
      related_user_id: userId,
    });

    return NextResponse.json({ success: true, friendship: data });
  } catch (e) {
    console.error("[social/friends POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH — Accept or decline friend request
export async function PATCH(req: NextRequest) {
  try {
    const { friendshipId, userId, action } = await req.json();
    if (!friendshipId || !userId || !["accept", "decline"].includes(action)) {
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

    // Notify the original requester that their request was accepted
    if (action === "accept") {
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
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (e) {
    console.error("[social/friends PATCH]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
