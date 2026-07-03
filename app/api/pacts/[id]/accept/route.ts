import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import { notifyUser } from "@/lib/db";
import {
  MAX_ACTIVE_PACTS,
  addDaysUtc,
  countActivePacts,
  loadMemberPact,
  todayUtc,
} from "@/lib/pacts";

export const dynamic = "force-dynamic";

/**
 * POST /api/pacts/[id]/accept — invitee activates a pending pact.
 *
 * Seeds last_both_day to (today - 1) as the counting CURSOR: the lazy
 * reconcile only counts both-days strictly after the cursor, so activity from
 * before the pact went active can never retroactively mint a streak (or a
 * milestone payout). If both members study on accept day itself, that day
 * counts as joint day 1.
 *
 * Demo-guarded: activating a pact opens a Fang-earning path (milestones), and
 * the shared demo account must never accrue currency.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (isDemoUser(userId)) return demoBlockedResponse();

  try {
    const pact = await loadMemberPact(params.id, userId);
    if (pact === "missing-schema") {
      return NextResponse.json({ error: "Pacts aren't live yet." }, { status: 503 });
    }
    if (!pact || pact.status !== "pending") {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (pact.invited_by === userId) {
      return NextResponse.json({ error: "You sent this invite. Your friend has to accept it." }, { status: 403 });
    }

    // Cap re-check for BOTH sides at activation time.
    const partnerId = pact.user_a === userId ? pact.user_b : pact.user_a;
    const [mine, theirs] = await Promise.all([
      countActivePacts(userId),
      countActivePacts(partnerId),
    ]);
    if ((mine ?? 0) >= MAX_ACTIVE_PACTS) {
      return NextResponse.json(
        { error: `You already have ${MAX_ACTIVE_PACTS} active pacts. End one first.` },
        { status: 409 },
      );
    }
    if ((theirs ?? 0) >= MAX_ACTIVE_PACTS) {
      return NextResponse.json(
        { error: "Your friend is already at their pact limit." },
        { status: 409 },
      );
    }

    // CAS on status so a concurrent decline/cancel can't be overwritten.
    const cursor = addDaysUtc(todayUtc(), -1);
    const { data: activated, error } = await supabaseAdmin
      .from("streak_pacts")
      .update({ status: "active", last_both_day: cursor, current_streak: 0 })
      .eq("id", pact.id)
      .eq("status", "pending")
      .select("id");
    if (error) {
      console.error("[pacts accept]", error.message);
      return NextResponse.json({ error: "Couldn't accept the pact." }, { status: 500 });
    }
    if (!activated || activated.length === 0) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    // Tell the inviter (best-effort, pref-gated).
    const { data: me } = await supabaseAdmin
      .from("profiles").select("username").eq("id", userId).single();
    await notifyUser({
      userId: pact.invited_by,
      prefKey: "friend_accepted",
      type: "pact_accepted",
      title: `${me?.username ?? "Your friend"} accepted your Streak Pact`,
      message: "Your shared streak starts today. Both of you study, the flame grows.",
      action_url: "/dashboard",
      related_user_id: userId,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[pacts accept]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
