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
import { shouldNotifyUser, isInQuietHours } from "@/lib/db";

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

  // Perf pass 2026-06-10 — the five pre-insert checks were sequential
  // round-trips (friendship → room → inRoom → alreadyIn → profiles). They
  // collapse into two parallel batches: [friendship, room, profiles] (all
  // independent), then [inRoom, alreadyIn] (need room.id). Same checks, same
  // error precedence, roughly half the sender-side button latency.

  // ── Batch 1: friendship gate + room lookup + username lookups ──
  // Friendship check mirrors the accepted-status OR-check used by
  // /api/social/messages POST. The friend graph IS the access control — we
  // never let a non-friend get a party_invite notification from here.
  //
  // Bug fix 2026-06-10 (live playtest 403): every query error used to be
  // silently destructured away as data:null, so a failing check read as
  // "gate not satisfied" instead of "query broke". All errors are now
  // captured + logged, and check queries return arrays via .limit(1) so a
  // surprise multi-row result can never poison the result the way a bare
  // .maybeSingle() does (maybeSingle errors on >1 row).
  //
  // Room lookup: party_rooms.code is UNIQUE today, but order by created_at
  // DESC + limit(1) defends against any future code-reuse scheme — we always
  // act on the most recent non-ended room for the code.
  const [friendshipQ, roomQ, senderQ, receiverQ] = await Promise.all([
    supabaseAdmin
      .from("friendships")
      .select("id")
      .or(
        `and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`,
      )
      .eq("status", "accepted")
      .limit(1),
    supabaseAdmin
      .from("party_rooms")
      .select("id, host_user_id, status")
      .eq("code", code)
      .neq("status", "ended")
      .order("created_at", { ascending: false })
      .limit(1),
    supabaseAdmin.from("profiles").select("username").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("profiles").select("username").eq("id", friendId).maybeSingle(),
  ]);
  if (friendshipQ.error || roomQ.error) {
    if (friendshipQ.error) console.error("[invite-friend] friendship check failed", friendshipQ.error.message);
    if (roomQ.error) console.error("[invite-friend] room lookup failed", roomQ.error.message);
    return NextResponse.json({ error: "Couldn't send invite" }, { status: 500 });
  }
  if (senderQ.error) console.error("[invite-friend] sender profile lookup failed", senderQ.error.message);
  if (receiverQ.error) console.error("[invite-friend] receiver profile lookup failed", receiverQ.error.message);
  const senderProfile = senderQ.data;
  const receiverProfile = receiverQ.data;
  if (!friendshipQ.data || friendshipQ.data.length === 0) {
    return NextResponse.json({ error: "Not friends" }, { status: 403 });
  }
  const room = roomQ.data?.[0];
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // ── Batch 2: sender must be in the room + receiver must not already be ──
  // Anyone with the code can join, but only people already in the room are
  // allowed to summon their friends to it. This stops a code-leaker from
  // weaponizing this endpoint for "drag random user X into room ABC123".
  // No-op invites are confusing — the receiver would see a notification for
  // a room they're already inside, hence the 409.
  //
  // ROOT CAUSE of the playtest 403: these two checks selected "id" from
  // party_room_players, but that table has NO id column (its PK is the
  // composite (room_id, user_id) — see migration 20260526230000). PostgREST
  // errored with "column party_room_players.id does not exist", the error was
  // silently discarded, inRoom read as null, and EVERY invite 403'd with
  // "Join the room before inviting friends" even for hosts standing in the
  // lobby. Select a real column, capture errors, and 500 on query failure
  // instead of misreporting it as a membership failure.
  const [inRoomQ, alreadyInQ] = await Promise.all([
    supabaseAdmin
      .from("party_room_players")
      .select("user_id")
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .is("left_at", null)
      .limit(1),
    supabaseAdmin
      .from("party_room_players")
      .select("user_id")
      .eq("room_id", room.id)
      .eq("user_id", friendId)
      .is("left_at", null)
      .limit(1),
  ]);
  if (inRoomQ.error || alreadyInQ.error) {
    if (inRoomQ.error) console.error("[invite-friend] inRoom check failed", inRoomQ.error.message);
    if (alreadyInQ.error) console.error("[invite-friend] alreadyIn check failed", alreadyInQ.error.message);
    return NextResponse.json({ error: "Couldn't send invite" }, { status: 500 });
  }
  if (!inRoomQ.data || inRoomQ.data.length === 0) {
    return NextResponse.json(
      { error: "Join the room before inviting friends" },
      { status: 403 },
    );
  }
  if ((alreadyInQ.data?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: "Already in this room" },
      { status: 409 },
    );
  }

  // ── Privacy/notification gate (Settings overhaul 2026-06-11) ──
  // Honor the receiver's `party_invites` in-app toggle AND quiet hours. When
  // the receiver opted out (or is inside quiet hours) we skip both the
  // notification insert and the Realtime broadcast, but the invite ACTION
  // still succeeds (ok:true) — consistent with every other gated site, where
  // the underlying action happens and only the ping is suppressed. The room
  // membership/access control already ran above; this only governs the ping.
  if (
    !(await shouldNotifyUser(friendId, "party_invites")) ||
    (await isInQuietHours(friendId))
  ) {
    return NextResponse.json({
      ok: true,
      invitedUsername: receiverProfile?.username ?? null,
    });
  }

  // ── Drop the notification ──
  // Deep-links to the party route. Persisted as the durable source of truth so
  // the friend sees it in their bell + dropdown; also fed to the Realtime
  // broadcast below for instant delivery.
  const { data: notifRow, error: notifErr } = await supabaseAdmin
    .from("notifications")
    .insert({
      user_id: friendId,
      type: "party_invite",
      title: `${senderProfile?.username ?? "A friend"} invited you to Lionade Party`,
      message: `Tap to join room ${code}`,
      action_url: `/games/party/${code}`,
      related_user_id: userId,
    })
    .select("id, user_id, type, title, message, action_url, related_user_id")
    .single();
  if (notifErr || !notifRow) {
    console.error("[invite-friend] notification insert failed", notifErr?.message);
    return NextResponse.json(
      { error: "Couldn't deliver invite" },
      { status: 500 },
    );
  }

  // ── Direct Realtime broadcast (delivery path #2, 2026-06-10) ──
  // The INSERT above already reaches the receiver via the Navbar's
  // postgres_changes listener on channel `notifs-${userId}`, but pg_changes
  // delivery can lag (WAL polling) or drop under reconnect. Broadcasting the
  // same notification row as a `party_invite` broadcast event on that SAME
  // channel gives an instant second path; the Navbar listens for both and
  // PartyInviteToast dedupes by notification id, so double delivery shows one
  // toast. Best-effort: a broadcast failure never fails the invite (the
  // notification row is the durable source of truth).
  const ch = supabaseAdmin.channel(`notifs-${friendId}`);
  await ch
    .send({ type: "broadcast", event: "party_invite", payload: notifRow })
    .catch((err: unknown) => {
      console.warn("[invite-friend] broadcast warn:", err);
    })
    .finally(() => {
      void supabaseAdmin.removeChannel(ch);
    });

  return NextResponse.json({
    ok: true,
    invitedUsername: receiverProfile?.username ?? null,
  });
}
