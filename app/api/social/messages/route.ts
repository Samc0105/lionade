import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

// GET — Conversation history between two users
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const friendId = req.nextUrl.searchParams.get("friendId");
    const limit = Math.max(1, Math.min(200, parseInt(req.nextUrl.searchParams.get("limit") ?? "50")));

    if (!isUuid(friendId)) {
      return NextResponse.json({ error: "Invalid friendId" }, { status: 400 });
    }

    // Get messages between the two users.
    // Both userId (from JWT) and friendId (UUID-validated) are safe to interpolate.
    const { data: messages, error } = await supabaseAdmin
      .from("messages")
      .select("id, sender_id, receiver_id, content, read, created_at")
      .or(
        `and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`,
      )
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("[social/messages GET]", error.message);
      return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
    }

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
        `and(user1_id.eq.${userId},user2_id.eq.${friendId}),and(user1_id.eq.${friendId},user2_id.eq.${userId})`,
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
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const senderId = auth.userId;

  try {
    const body = await req.json();
    const { receiverId, content } = body;
    const cleanContent = String(content ?? "").trim().slice(0, 1000);

    if (!isUuid(receiverId)) {
      return NextResponse.json({ error: "Invalid receiverId" }, { status: 400 });
    }
    if (!cleanContent) {
      return NextResponse.json({ error: "Empty message" }, { status: 400 });
    }

    // Verify they're friends
    const { data: friendship } = await supabaseAdmin
      .from("friendships")
      .select("id")
      .or(
        `and(user_id.eq.${senderId},friend_id.eq.${receiverId}),and(user_id.eq.${receiverId},friend_id.eq.${senderId})`,
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
        content: cleanContent,
        read: false,
      })
      .select()
      .single();

    if (error) {
      console.error("[social/messages POST]", error.message);
      return NextResponse.json({ error: "Failed to send" }, { status: 500 });
    }
    return NextResponse.json({ message: data });
  } catch (e) {
    console.error("[social/messages POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
