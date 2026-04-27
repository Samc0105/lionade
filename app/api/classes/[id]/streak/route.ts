import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/classes/[id]/streak
 *
 * Returns the per-class streak record for the authed user, plus a derived
 * `alive` flag (true when the last activity was within the 36h grace
 * window — same window enforced by lib/class-streaks.ts).
 *
 * If no row exists yet, returns the zero-state shape so the chip can
 * render a "start a streak" CTA without an extra round-trip.
 */

type RouteCtx = { params: { id: string } };

const GRACE_WINDOW_MS = 36 * 60 * 60 * 1000;

interface StreakResponse {
  streak: number;
  longest: number;
  lastActivityAt: string | null;
  alive: boolean;
}

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  // Ownership check on the class.
  const { data: cls } = await supabaseAdmin
    .from("classes")
    .select("user_id")
    .eq("id", classId)
    .single();
  if (!cls || cls.user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("class_streaks")
    .select("current_streak, longest_streak, last_activity_at")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .maybeSingle();

  if (error) {
    console.error("[classes/:id/streak GET]", error.message);
    return NextResponse.json({ error: "Couldn't load streak." }, { status: 500 });
  }

  const lastActivityAt = data?.last_activity_at ?? null;
  const alive = lastActivityAt
    ? Date.now() - new Date(lastActivityAt).getTime() < GRACE_WINDOW_MS
    : false;

  const payload: StreakResponse = {
    streak: data?.current_streak ?? 0,
    longest: data?.longest_streak ?? 0,
    lastActivityAt,
    alive,
  };
  return NextResponse.json(payload);
}
