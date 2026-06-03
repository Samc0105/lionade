import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/vocab/streak
 *
 * Returns the user's language streak per pair, e.g.
 *   { streaks: [{ langPair: 'es-en', count: 7, lastDay: '2026-06-03', maxStreak: 12 }, ...] }
 *
 * Sourced from `vocab_streaks` (see 20260603090250_vocab_words.sql). Empty
 * array if the user has no streaks yet.
 *
 * Note: this endpoint does NOT recompute / decay streaks server-side. A
 * streak's "live" status (still active vs broken) is the UI's call based on
 * lastDay relative to today. The next /api/vocab/words POST (via the
 * advance_vocab_streak RPC) is what actually resets a broken streak.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data, error } = await supabaseAdmin
    .from("vocab_streaks")
    .select("source_lang, target_lang, streak_count, streak_last_day, max_streak")
    .eq("user_id", userId)
    .order("streak_count", { ascending: false });

  if (error) {
    console.error("[vocab/streak GET]", error.message);
    return NextResponse.json({ error: "Couldn't load streaks" }, { status: 500 });
  }

  const streaks = (data ?? []).map((r) => ({
    langPair: `${r.source_lang as string}-${r.target_lang as string}`,
    count: (r.streak_count as number) ?? 0,
    lastDay: (r.streak_last_day as string | null) ?? null,
    maxStreak: (r.max_streak as number) ?? 0,
  }));

  return NextResponse.json({ streaks });
}
