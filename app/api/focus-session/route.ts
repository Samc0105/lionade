import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * Focus Lock-In — claim the bonus on a completed deep-work session.
 *
 * POST /api/focus-session
 *   Body: { durationMinutes: 25 | 45 | 60 }
 *   Server validates the duration is one of the allowed presets and
 *   that the user hasn't already claimed too many sessions today
 *   (caps abuse). Grants Fangs based on duration.
 *
 * The actual TIMER runs entirely client-side; this endpoint just
 * records the completion and grants the reward. We don't try to verify
 * the user actually focused — that's an honor system. The cap below
 * is the abuse guard.
 *
 * Reward formula (linear in time, with bonus for longer focus):
 *   25 min → 25F
 *   45 min → 50F  (+5 bonus)
 *   60 min → 75F  (+15 bonus)
 */

const ALLOWED_DURATIONS = [25, 45, 60] as const;
type AllowedDuration = typeof ALLOWED_DURATIONS[number];

const FANGS_BY_DURATION: Record<AllowedDuration, number> = {
  25: 25,
  45: 50,
  60: 75,
};

const MAX_SESSIONS_PER_DAY = 6;

interface CompleteBody {
  durationMinutes?: number;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: CompleteBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const duration = Number(body.durationMinutes);
  if (!ALLOWED_DURATIONS.includes(duration as AllowedDuration)) {
    return NextResponse.json({
      error: `Duration must be one of ${ALLOWED_DURATIONS.join(", ")} minutes.`,
    }, { status: 400 });
  }

  const reward = FANGS_BY_DURATION[duration as AllowedDuration];

  try {
    // Abuse cap — count today's focus sessions. Cheap; just a coin
    // transaction lookup since we record one per session.
    const todayUtc = new Date().toISOString().slice(0, 10);
    const { count: todayCount } = await supabaseAdmin
      .from("coin_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("type", "focus_session")
      .gte("created_at", `${todayUtc}T00:00:00.000Z`);

    if ((todayCount ?? 0) >= MAX_SESSIONS_PER_DAY) {
      return NextResponse.json({
        ok: false,
        reason: "daily_cap",
        message: `You've completed ${MAX_SESSIONS_PER_DAY} focus sessions today — come back tomorrow.`,
      });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .single();
    const newBalance = ((profile as { coins?: number } | null)?.coins ?? 0) + reward;

    await Promise.all([
      supabaseAdmin.from("profiles").update({ coins: newBalance }).eq("id", userId),
      supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: reward,
        type: "focus_session",
        description: `Focus Lock-In (${duration} min)`,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      durationMinutes: duration,
      coinsEarned: reward,
      coins: newBalance,
      sessionsToday: (todayCount ?? 0) + 1,
      cap: MAX_SESSIONS_PER_DAY,
    });
  } catch (e) {
    console.error("[focus-session POST]", e);
    return NextResponse.json({ error: "Couldn't record session." }, { status: 500 });
  }
}
