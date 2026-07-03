import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import { notifyUser } from "@/lib/db";
import {
  MAX_ACTIVE_PACTS,
  PACT_COLUMNS,
  type PactRow,
  countActivePacts,
  fetchPactActivity,
  grantPactMilestone,
  isMissingSchema,
  orderPair,
  reconcileStreak,
  todayUtc,
} from "@/lib/pacts";

export const dynamic = "force-dynamic";

/**
 * Streak Pacts — list (GET) + invite (POST).
 *
 * GET performs the LAZY RECONCILE: for each of the caller's active pacts it
 * replays daily_activity history from the last_both_day cursor (deterministic
 * and idempotent, see lib/pacts.ts), persists any change, and grants the
 * 7/30-day milestone Fangs guarded by compare-and-swap booleans. Fail-soft
 * everywhere: when the HELD streak_pacts migration is unapplied the response
 * is { available: false } and the UI self-hides; when only the ledger-type
 * widening is unapplied, milestones report milestonePending instead of paying.
 */

interface ProfileLite {
  id: string;
  username: string;
  avatar_url: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNAVAILABLE = {
  available: false as const,
  maxActive: MAX_ACTIVE_PACTS,
  pacts: [] as never[],
  incoming: [] as never[],
  outgoing: [] as never[],
};

// ─────────────────────────────────────────────────────────────────────────────
// GET — list pacts + lazy reconcile + milestone grants
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data: rows, error } = await supabaseAdmin
      .from("streak_pacts")
      .select(PACT_COLUMNS)
      .or(`user_a.eq.${userId},user_b.eq.${userId}`)
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false });

    if (error) {
      // HELD migration unapplied — feature self-hides, never 500s.
      if (isMissingSchema(error)) return NextResponse.json(UNAVAILABLE);
      console.error("[pacts GET] list:", error.message);
      return NextResponse.json({ error: "Couldn't load pacts." }, { status: 500 });
    }

    const pacts = (rows ?? []) as PactRow[];
    const today = todayUtc();

    // Partner profiles for every row, one batched query.
    const partnerIds = Array.from(
      new Set(pacts.map((p) => (p.user_a === userId ? p.user_b : p.user_a))),
    );
    const profileMap = new Map<string, ProfileLite>();
    if (partnerIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", partnerIds);
      for (const p of (profs ?? []) as ProfileLite[]) profileMap.set(p.id, p);
    }

    const active = pacts.filter((p) => p.status === "active");

    // Reconcile each active pact (max 3, activity queries run in parallel).
    const activitySets = await Promise.all(active.map((p) => fetchPactActivity(p, today)));

    const activePayload = [];
    for (let i = 0; i < active.length; i++) {
      const pact = active[i];
      const activity = activitySets[i];
      const partnerId = pact.user_a === userId ? pact.user_b : pact.user_a;
      const partner = profileMap.get(partnerId);

      let currentStreak = pact.current_streak;
      let bestStreak = pact.best_streak;
      let lastBothDay = pact.last_both_day;
      let milestone7 = pact.milestone_7_granted;
      let milestone30 = pact.milestone_30_granted;
      let milestonePending = false;
      let youStudiedToday = false;
      let partnerStudiedToday = false;

      if (activity) {
        const daysMe = pact.user_a === userId ? activity.daysA : activity.daysB;
        const daysPartner = pact.user_a === userId ? activity.daysB : activity.daysA;
        youStudiedToday = daysMe.has(today);
        partnerStudiedToday = daysPartner.has(today);

        const r = reconcileStreak(pact, activity.daysA, activity.daysB, today);
        currentStreak = r.currentStreak;
        bestStreak = r.bestStreak;
        lastBothDay = r.lastBothDay;

        if (r.changed) {
          // Deterministic values — concurrent reconciles write the same thing.
          const { error: upErr } = await supabaseAdmin
            .from("streak_pacts")
            .update({
              current_streak: r.currentStreak,
              best_streak: r.bestStreak,
              last_both_day: r.lastBothDay,
            })
            .eq("id", pact.id);
          if (upErr) console.error("[pacts GET] reconcile write:", upErr.message);
        }

        // Milestones fire off the BEST streak so a multi-day catch-up that
        // crossed a threshold still pays. Booleans make each one one-shot.
        const members = orderPair(pact.user_a, pact.user_b);
        if (bestStreak >= 7 && !milestone7) {
          const g = await grantPactMilestone(pact.id, members, 7);
          if (g === "granted") milestone7 = true;
          else if (g === "pending") milestonePending = true;
        }
        if (bestStreak >= 30 && !milestone30) {
          const g = await grantPactMilestone(pact.id, members, 30);
          if (g === "granted") milestone30 = true;
          else if (g === "pending") milestonePending = true;
        }
      }

      activePayload.push({
        id: pact.id,
        partner: partner ?? { id: partnerId, username: "Study buddy", avatar_url: null },
        currentStreak,
        bestStreak,
        lastBothDay,
        youStudiedToday,
        partnerStudiedToday,
        milestone7Granted: milestone7,
        milestone30Granted: milestone30,
        milestonePending,
        canNudge: !partnerStudiedToday && pact.last_nudge_day !== today,
        createdAt: pact.created_at,
      });
    }

    const shapeInvite = (p: PactRow) => {
      const otherId = p.user_a === userId ? p.user_b : p.user_a;
      const other = profileMap.get(otherId);
      return {
        id: p.id,
        partner: other ?? { id: otherId, username: "Study buddy", avatar_url: null },
        createdAt: p.created_at,
      };
    };

    return NextResponse.json({
      available: true,
      maxActive: MAX_ACTIVE_PACTS,
      activeCount: activePayload.length,
      pacts: activePayload,
      incoming: pacts.filter((p) => p.status === "pending" && p.invited_by !== userId).map(shapeInvite),
      outgoing: pacts.filter((p) => p.status === "pending" && p.invited_by === userId).map(shapeInvite),
    });
  } catch (e) {
    console.error("[pacts GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — invite an accepted friend to a pact
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // Shared demo account: same social-spam rationale as friend requests.
  if (isDemoUser(userId)) return demoBlockedResponse();

  try {
    const body = await req.json().catch(() => ({}));
    const friendId = typeof body?.friendId === "string" ? body.friendId : null;
    if (!friendId || !UUID_RE.test(friendId)) {
      return NextResponse.json({ error: "Missing friendId" }, { status: 400 });
    }
    if (friendId === userId) {
      return NextResponse.json({ error: "You can't pact with yourself" }, { status: 400 });
    }

    // Must be accepted friends (friendships is the source of truth).
    const { data: friendship } = await supabaseAdmin
      .from("friendships")
      .select("id")
      .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`)
      .eq("status", "accepted")
      .maybeSingle();
    if (!friendship) {
      return NextResponse.json({ error: "You can only pact with friends" }, { status: 403 });
    }

    // Cap: up to 3 ACTIVE pacts per user (re-checked at accept for both sides).
    const myActive = await countActivePacts(userId);
    if (myActive === null) {
      return NextResponse.json({ error: "Pacts aren't live yet. Check back soon." }, { status: 503 });
    }
    if (myActive >= MAX_ACTIVE_PACTS) {
      return NextResponse.json(
        { error: `You already have ${MAX_ACTIVE_PACTS} active pacts. End one to start another.` },
        { status: 409 },
      );
    }

    const [userA, userB] = orderPair(userId, friendId);

    // One row per pair, ever. Ended rows get RECYCLED (streak reset, milestone
    // booleans preserved so a pair can't re-farm the same milestone).
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("streak_pacts")
      .select(PACT_COLUMNS)
      .eq("user_a", userA)
      .eq("user_b", userB)
      .maybeSingle();
    if (exErr) {
      if (isMissingSchema(exErr)) {
        return NextResponse.json({ error: "Pacts aren't live yet. Check back soon." }, { status: 503 });
      }
      console.error("[pacts POST] existing lookup:", exErr.message);
      return NextResponse.json({ error: "Couldn't send the pact invite." }, { status: 500 });
    }

    const row = existing as PactRow | null;
    if (row?.status === "pending") {
      return NextResponse.json({ error: "A pact invite is already pending with this friend" }, { status: 409 });
    }
    if (row?.status === "active") {
      return NextResponse.json({ error: "You already have an active pact with this friend" }, { status: 409 });
    }

    let pactId: string;
    if (row) {
      // Recycle the ended row.
      const { data: recycled, error: recErr } = await supabaseAdmin
        .from("streak_pacts")
        .update({
          status: "pending",
          invited_by: userId,
          current_streak: 0,
          last_both_day: null,
          last_nudge_day: null,
          created_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "ended")
        .select("id");
      if (recErr) {
        console.error("[pacts POST] recycle:", recErr.message);
        return NextResponse.json({ error: "Couldn't send the pact invite." }, { status: 500 });
      }
      if (!recycled || recycled.length === 0) {
        // Zero rows from the status-guarded update means a CONCURRENT
        // re-invite already flipped this ended row to pending (or an accept
        // made it active) between our read and this write. That is a benign
        // race, not a server fault: answer like the duplicate-pending path.
        return NextResponse.json(
          { error: "A pact invite is already pending with this friend" },
          { status: 409 },
        );
      }
      pactId = row.id;
    } else {
      const { data: created, error: insErr } = await supabaseAdmin
        .from("streak_pacts")
        .insert({ user_a: userA, user_b: userB, invited_by: userId, status: "pending" })
        .select("id")
        .single();
      if (insErr || !created) {
        if (insErr?.code === "23505") {
          return NextResponse.json({ error: "A pact already exists with this friend" }, { status: 409 });
        }
        console.error("[pacts POST] insert:", insErr?.message ?? "no row");
        return NextResponse.json({ error: "Couldn't send the pact invite." }, { status: 500 });
      }
      pactId = created.id as string;
    }

    // Bell ping for the invitee (best-effort, gated on their social pref).
    const { data: me } = await supabaseAdmin
      .from("profiles").select("username").eq("id", userId).single();
    await notifyUser({
      userId: friendId,
      prefKey: "friend_requests",
      type: "pact_invite",
      title: `${me?.username ?? "A friend"} invited you to a Streak Pact`,
      message: "Study on the same days and build a shared streak. Accept in Social.",
      action_url: "/social",
      related_user_id: userId,
    });

    return NextResponse.json({ success: true, pactId });
  } catch (e) {
    console.error("[pacts POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
