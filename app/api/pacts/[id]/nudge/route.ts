import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import { notifyUser } from "@/lib/db";
import { loadMemberPact, todayUtc } from "@/lib/pacts";

export const dynamic = "force-dynamic";

/**
 * POST /api/pacts/[id]/nudge — poke your pact partner to study today.
 *
 * Rate limit: 1 nudge per pact per UTC day, enforced atomically by a
 * compare-and-swap on streak_pacts.last_nudge_day (update only wins when the
 * stored day is null or older than today), so two racing taps can't both
 * send. Fixed copy only (no user text), delivered through the central
 * notifyUser helper which honors the recipient's nudge_received pref and
 * quiet hours.
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
    if (!pact || pact.status !== "active") {
      return NextResponse.json({ error: "Pact not found" }, { status: 404 });
    }

    const partnerId = pact.user_a === userId ? pact.user_b : pact.user_a;
    const today = todayUtc();

    // Pointless-nudge guard: if the partner already studied today, say so
    // instead of pinging them.
    const { data: partnerToday } = await supabaseAdmin
      .from("daily_activity")
      .select("id")
      .eq("user_id", partnerId)
      .eq("date", today)
      .maybeSingle();
    if (partnerToday) {
      return NextResponse.json(
        { ok: false, reason: "partner_active", error: "Your partner already studied today. The pact is safe." },
        { status: 400 },
      );
    }

    // Atomic 1/day per pact: only one update can flip last_nudge_day to today.
    const { data: claimed, error: casErr } = await supabaseAdmin
      .from("streak_pacts")
      .update({ last_nudge_day: today })
      .eq("id", pact.id)
      .eq("status", "active")
      .or(`last_nudge_day.is.null,last_nudge_day.lt.${today}`)
      .select("id");
    if (casErr) {
      console.error("[pacts nudge] CAS:", casErr.message);
      return NextResponse.json({ error: "Couldn't send the nudge." }, { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      return NextResponse.json(
        { ok: false, reason: "already_nudged", error: "This pact already used today's nudge." },
        { status: 429 },
      );
    }

    const { data: me } = await supabaseAdmin
      .from("profiles").select("username").eq("id", userId).single();
    await notifyUser({
      userId: partnerId,
      prefKey: "nudge_received",
      type: "pact_nudge",
      title: `${me?.username ?? "Your pact partner"} is counting on you`,
      message: "Your pact streak needs both of you today. One quick session keeps the flame alive.",
      action_url: "/dashboard",
      related_user_id: userId,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[pacts nudge]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
