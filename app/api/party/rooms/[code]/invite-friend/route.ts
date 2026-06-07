// POST /api/party/rooms/[code]/invite-friend
//
// Invite an accepted friend to a party room via the notifications system.
// Drops a `party_invite` notification on the friend with a deep-link to the
// room. Sender must be IN the room. Receiver must be the sender's accepted
// friend (the friend graph is the access control — we never list/invite
// non-friends from here).
//
// Body: { friendId: string (uuid) }
// Response: { ok: true, invitedUsername }
//
// Auth: requireAuth + demo-blocked (the publicly-known demo account would
// otherwise spam every real user's room).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (isDemoUser(userId)) return demoBlockedResponse();

  const code = normalizeRoomCode(params.code);
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  let body: { friendId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const friendId = typeof body.friendId === "string" ? body.friendId : "";
  if (!UUID_RE.test(friendId)) {
    return NextResponse.json({ error: "Invalid friendId" }, { status: 400 });
  }
  if (friendId === userId) {
    return NextResponse.json({ error: "You can't invite yourself" }, { status: 400 });
  }

  // ── Friendship gate ──
  // Mirror the same accepted-status OR-check used by /api/social/messages
  // POST. The friend graph IS the access control — we never let a non-friend
  // get a party_invite notification from this endpoint.
  const { data: friendship } = await supabaseAdmin
    .from("friendships")
    .select("id")
    .or(
      `and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`,
    )
    .eq("status", "accepted")
    .limit(1)
    .maybeSingle();
  if (!friendship) {
    return NextResponse.json({ error: "Not friends" }, { status: 403 });
  }

  // ── Sender must be in the room ──
  // Anyone with the code can join, but only people already in the room are
  // allowed to summon their friends to it. This stops a code-leaker from
  // weaponizing this endpoint for "drag random user X into room ABC123".
  const { data: room } = await supabaseAdmin
    .from("party_rooms")
    .select("id, host_user_id, status")
    .eq("code", code)
    .neq("status", "ended")
    .maybeSingle();
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  const { data: inRoom } = await supabaseAdmin
    .from("party_room_players")
    .select("id")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (!inRoom) {
    return NextResponse.json(
      { error: "Join the room before inviting friends" },
      { status: 403 },
    );
  }

  // ── Receiver must not already be in this room ──
  // No-op invites are confusing — they'd see a notification for a room they're
  // already inside. Bail with a clear 409.
  const { data: alreadyIn } = await supabaseAdmin
    .from("party_room_players")
    .select("id")
    .eq("room_id", room.id)
    .eq("user_id", friendId)
    .is("left_at", null)
    .maybeSingle();
  if (alreadyIn) {
    return NextResponse.json(
      { error: "Already in this room" },
      { status: 409 },
    );
  }

  // ── Lookup sender + receiver usernames for the toast / notification body ──
  const [{ data: senderProfile }, { data: receiverProfile }] = await Promise.all([
    supabaseAdmin.from("profiles").select("username").eq("id", userId).single(),
    supabaseAdmin.from("profiles").select("username").eq("id", friendId).single(),
  ]);

  // ── Drop the notification ──
  // Deep-links to the party route. Friend invites are an explicit 1:1
  // social action between accepted friends, so the row ALWAYS persists (the
  // friend can see it in their bell + dropdown). Suppressing the row entirely
  // when a pref was off meant a friend who muted "marketing-style" pings would
  // also miss real invites from their friends, which broke the social loop.
  // Pref-driven suppression for invites is a UI-layer choice on the receiver
  // side, not a server-side drop.
  const { error: notifErr } = await supabaseAdmin.from("notifications").insert({
    user_id: friendId,
    type: "party_invite",
    title: `${senderProfile?.username ?? "A friend"} invited you to Lionade Party`,
    message: `Tap to join room ${code}`,
    action_url: `/games/party/${code}`,
    related_user_id: userId,
  });
  if (notifErr) {
    console.error("[invite-friend] notification insert failed", notifErr);
    return NextResponse.json(
      { error: "Couldn't deliver invite" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    invitedUsername: receiverProfile?.username ?? null,
  });
}
