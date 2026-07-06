import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import { notifyUser, DEFAULT_PRIVACY_PREFS, type PrivacyPrefs } from "@/lib/db";
import { fetchTopFounderFlairByUser } from "@/lib/cosmetics/founder-flair";
import { awardBadges } from "@/lib/badges";

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
      // Equipped cosmetics — the /social frontend renders frame + aura on the
      // avatar and name color/effect on the username for every row, so the list
      // endpoint must pull all four equipped_* pointers (not just the effect).
      equipped_username_effect: string | null;
      equipped_frame: string | null;
      equipped_name_color: string | null;
      equipped_avatar_aura: string | null;
    };
    const profileMap = new Map<string, Profile>();
    if (profileIds.size > 0) {
      const { data: profileRows } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url, arena_elo, is_online, last_seen, equipped_username_effect, equipped_frame, equipped_name_color, equipped_avatar_aura")
        .in("id", Array.from(profileIds));
      for (const p of (profileRows ?? []) as Profile[]) {
        profileMap.set(p.id, p);
      }
    }

    // Founder-badge flair per user — one batched query. founder_grants is RLS
    // own-only, so this server route resolves it on supabaseAdmin. Display-only.
    const flairMap = await fetchTopFounderFlairByUser(Array.from(profileIds));

    // Build unread-count map
    const unreadMap: Record<string, number> = {};
    for (const m of unreadRows) {
      unreadMap[m.sender_id] = (unreadMap[m.sender_id] ?? 0) + 1;
    }

    // Equipped-cosmetic passthrough — the /social rows render frame + aura on the
    // avatar and color/effect on the name, so every response shape carries all
    // four equipped_* pointers verbatim (null = nothing equipped = plain render).
    const cosmeticsOf = (p: Profile) => ({
      equipped_username_effect: p.equipped_username_effect,
      equipped_frame: p.equipped_frame,
      equipped_name_color: p.equipped_name_color,
      equipped_avatar_aura: p.equipped_avatar_aura,
      flair: flairMap.get(p.id) ?? null,
    });

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
          ...cosmeticsOf(p),
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
          ...cosmeticsOf(p),
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
          ...cosmeticsOf(p),
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

  // Shared demo account: friend-request spam mitigation. Same rationale as
  // the DM guard — the demo user is publicly known, so leaving friend
  // requests open would let any tester spam every real user.
  if (isDemoUser(userId)) return demoBlockedResponse();

  try {
    const { friendUsername, friendId } = await req.json();
    if (!friendUsername && !friendId) {
      return NextResponse.json({ error: "Missing friendUsername or friendId" }, { status: 400 });
    }

    // Prefer id lookup when the client passes one (search results carry the
    // profile id) — it sidesteps username-charset pitfalls entirely. Fall
    // back to username for the manual-entry path. Pulls `preferences` in the
    // same round trip so the privacy check below is free.
    let friendQuery = supabaseAdmin
      .from("profiles")
      .select("id, username, preferences");

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof friendId === "string" && UUID_RE.test(friendId)) {
      friendQuery = friendQuery.eq("id", friendId);
    } else {
      // Charset MUST match what username-creation paths actually allow:
      // sanitizeUsername (signup, @lionade/core) permits [a-z0-9_] up to 30,
      // the admin team provisioner permits dots and hyphens
      // (^[a-z][a-z0-9.-]{2,30}$), and seeded accounts like trainer-ninny
      // carry hyphens. Union: [a-z0-9._-], 3-31 chars. Underscore is BOTH a
      // legal username char and an ilike wildcard, so escape wildcards in
      // the query pattern instead of stripping them from the input (the old
      // strip-then-validate mangled real underscore usernames into 400s).
      const cleanUsername = String(friendUsername).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,31}$/.test(cleanUsername)) {
        return NextResponse.json({ error: "Invalid username" }, { status: 400 });
      }
      const ilikePattern = cleanUsername.replace(/[\\%_]/g, ch => `\\${ch}`);
      friendQuery = friendQuery.ilike("username", ilikePattern);
    }

    const { data: friend } = await friendQuery.single();

    if (!friend) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (friend.id === userId) return NextResponse.json({ error: "Cannot add yourself" }, { status: 400 });

    // Privacy enforcement (2026-06-11): respect the RECIPIENT's
    // privacy.friend_request_from pref server-side. Previously only the
    // notification was suppressed — the pending row still inserted, which
    // made "nobody" a placebo. Merge over defaults so users who saved prefs
    // before this key existed default to "everyone".
    const recipientPrivacy: PrivacyPrefs = {
      ...DEFAULT_PRIVACY_PREFS,
      ...(((friend.preferences as { privacy?: Partial<PrivacyPrefs> } | null)?.privacy) ?? {}),
    };
    if (recipientPrivacy.friend_request_from === "nobody") {
      return NextResponse.json(
        { error: "This user isn't accepting friend requests" },
        { status: 403 },
      );
    }

    // Check if friendship already exists. Fetch EVERY row for the pair, in
    // BOTH directions — legacy data (pre-unique-constraint) can hold one row
    // per direction, and deciding off a single arbitrary `.limit(1)` row is
    // what used to drive the revive into UNIQUE(user_id, friend_id) 500s.
    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from("friendships")
      .select("id, status, user_id, friend_id")
      .or(`and(user_id.eq.${userId},friend_id.eq.${friend.id}),and(user_id.eq.${friend.id},friend_id.eq.${userId})`);

    if (existingError) {
      console.error("[social/friends]", existingError.message);
      return NextResponse.json({ error: "Couldn't send friend request." }, { status: 500 });
    }

    const pairRows = existingRows ?? [];
    if (pairRows.some(r => r.status === "accepted")) {
      return NextResponse.json({ error: "Already friends" }, { status: 400 });
    }
    if (pairRows.some(r => r.status === "pending")) {
      return NextResponse.json({ error: "Request already pending" }, { status: 400 });
    }

    let friendship;
    if (pairRows.length > 0) {
      // Every remaining row is "declined" (accepted/pending returned above).
      // A declined row still occupies the UNIQUE(user_id, friend_id) slot, so
      // a fresh insert would violate the constraint (this used to 500). Revive
      // a row back to pending instead, re-pointing the direction at the new
      // sender so PATCH accept/decline (which checks friend_id = me) works
      // even when the original decliner is the one re-adding.
      const forward = pairRows.find(r => r.user_id === userId && r.friend_id === friend.id);
      const reverse = pairRows.find(r => r.user_id === friend.id && r.friend_id === userId);

      // Legacy duplicates: declined rows in BOTH directions. Re-pointing the
      // reverse row would collide with the forward row's UNIQUE slot (the
      // remaining revive 500), so delete the stale reverse row first and
      // revive the forward one. Fail-soft on the delete: reviving the forward
      // row keeps its own (user_id, friend_id) key, so it can't trip the
      // constraint even if the stale row lingers.
      if (forward && reverse) {
        const { error: staleError } = await supabaseAdmin
          .from("friendships")
          .delete()
          .eq("id", reverse.id)
          .eq("status", "declined");
        if (staleError) console.error("[social/friends]", staleError.message);
      }

      const target = (forward ?? reverse)!;
      // created_at refreshes so the request sorts as new. The status guard on
      // the update makes a concurrent accept/revive lose cleanly instead of
      // clobbering; maybeSingle treats "0 rows matched" as a race, not a crash.
      const { data: revived, error: reviveError } = await supabaseAdmin
        .from("friendships")
        .update({
          user_id: userId,
          friend_id: friend.id,
          status: "pending",
          created_at: new Date().toISOString(),
        })
        .eq("id", target.id)
        .eq("status", "declined")
        .select()
        .maybeSingle();

      if (reviveError) {
        // 23505 = a concurrent request already occupies the pair's slot, i.e.
        // a live request effectively exists. Answer like a duplicate tap
        // would, never a raw 500.
        if (reviveError.code === "23505") {
          return NextResponse.json({ error: "Request already pending" }, { status: 400 });
        }
        console.error("[social/friends]", reviveError.message);
        return NextResponse.json({ error: "Couldn't send friend request." }, { status: 500 });
      }
      if (!revived) {
        // Status guard matched 0 rows: a concurrent accept/revive won the
        // race. Same story — report the duplicate, don't 500.
        return NextResponse.json({ error: "Request already pending" }, { status: 400 });
      }
      friendship = revived;
    } else {
      const { data, error } = await supabaseAdmin
        .from("friendships")
        .insert({ user_id: userId, friend_id: friend.id, status: "pending" })
        .select()
        .single();

      if (error) {
        // Same race shielding as the revive path: a concurrent insert for the
        // pair means a request already exists — that's a duplicate, not a 500.
        if (error.code === "23505") {
          return NextResponse.json({ error: "Request already pending" }, { status: 400 });
        }
        console.error("[social/friends]", error.message);
        return NextResponse.json({ error: "Couldn't send friend request." }, { status: 500 });
      }
      friendship = data;
    }

    // Create notification for the receiver (non-blocking). Routed through the
    // central notifyUser helper, which gates on the `friend_requests` pref AND
    // quiet hours. The friendship row still creates (visible in /social pending
    // tab); we only suppress the bell ping.
    const { data: senderProfile } = await supabaseAdmin
      .from("profiles").select("username").eq("id", userId).single();
    await notifyUser({
      userId: friend.id,
      prefKey: "friend_requests",
      type: "friend_request",
      title: `${senderProfile?.username ?? "Someone"} sent you a friend request`,
      message: "Accept or decline in Social",
      action_url: "/social",
      related_user_id: userId,
    });

    return NextResponse.json({ success: true, friendship });
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

    // Notify the original requester (non-blocking). Routed through notifyUser
    // and gated on its OWN dedicated `friend_accepted` pref (no longer
    // piggybacking on friend_requests) plus quiet hours.
    if (action === "accept") {
      // Pride Member badge for BOTH sides of the new friendship. Awaited (a
      // serverless lambda can freeze after the response, dropping fire-and-
      // forget writes) but fail-soft: awardBadges never throws (lib/badges.ts).
      await awardBadges(supabaseAdmin, userId, { firstFriend: true });
      await awardBadges(supabaseAdmin, friendship.user_id, { firstFriend: true });

      const { data: acceptorProfile } = await supabaseAdmin
        .from("profiles").select("username").eq("id", userId).single();
      await notifyUser({
        userId: friendship.user_id,
        prefKey: "friend_accepted",
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
