import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET — Conversation history between two users
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    const friendId = req.nextUrl.searchParams.get("friendId");
    const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50");

    if (!userId || !friendId) {
      return NextResponse.json({ error: "Missing userId or friendId" }, { status: 400 });
    }

    // Get messages between the two users
    const { data: messages, error } = await supabaseAdmin
      .from("messages")
      .select("id, sender_id, receiver_id, content, read, created_at")
      .or(
        `and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`
      )
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Mark unread messages from friend as read
    await supabaseAdmin
      .from("messages")
      .update({ read: true })
      .eq("sender_id", friendId)
      .eq("receiver_id", userId)
      .eq("read", false);

    // Get arena chat events between these two users
    const { data: arenaEvents } = await supabaseAdmin
      .from("arena_chat_events")
      .select("*")
      .or(
        `and(user1_id.eq.${userId},user2_id.eq.${friendId}),and(user1_id.eq.${friendId},user2_id.eq.${userId})`
      )
      .order("created_at", { ascending: true })
      .limit(20);

    return NextResponse.json({
      messages: messages ?? [],
      arenaEvents: arenaEvents ?? [],
    });
  } catch (e) {
    console.error("[social/messages GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST — Send a message
export async function POST(req: NextRequest) {
  try {
    const { senderId, receiverId, content } = await req.json();
    if (!senderId || !receiverId || !content?.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Verify they're friends
    const { data: friendship } = await supabaseAdmin
      .from("friendships")
      .select("id")
      .or(
        `and(user_id.eq.${senderId},friend_id.eq.${receiverId}),and(user_id.eq.${receiverId},friend_id.eq.${senderId})`
      )
      .eq("status", "accepted")
      .limit(1)
      .maybeSingle();

    if (!friendship) {
      return NextResponse.json({ error: "Not friends" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("messages")
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        content: content.trim().slice(0, 1000),
        read: false,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ message: data });
  } catch (e) {
    console.error("[social/messages POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
