import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/vocab/streak
 *
 * V2 contract change: streaks are now per-bank, not per-language-pair.
 *
 * Returns:
 *   {
 *     streaks: [
 *       { bankId, bankName, count, lastDay, maxStreak },
 *       ...
 *     ]
 *   }
 *
 * Sourced from `vocab_streaks` (PK = user_id, bank_id) joined to vocab_banks
 * for the human-readable name. Empty array if the user has no streaks yet.
 *
 * Does NOT recompute / decay streaks server-side — the UI judges "live vs
 * broken" based on lastDay relative to today, and the next /api/vocab/words
 * POST is what actually resets a stale streak via the advance_vocab_streak
 * RPC.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // Pull streak rows + bank name in one round trip. PostgREST embedded-resource
  // selector via `vocab_banks(name)` — requires the FK declared in the schema.
  const { data, error } = await supabaseAdmin
    .from("vocab_streaks")
    .select("bank_id, streak_count, streak_last_day, max_streak, vocab_banks(name)")
    .eq("user_id", userId)
    .order("streak_count", { ascending: false });

  if (error) {
    console.error("[vocab/streak GET]", error.message);
    return NextResponse.json({ error: "Couldn't load streaks" }, { status: 500 });
  }

  type Row = {
    bank_id: string;
    streak_count: number | null;
    streak_last_day: string | null;
    max_streak: number | null;
    // Supabase JS returns embedded one-to-one as either object or array
    // depending on relationship hint inference. Accept both shapes.
    vocab_banks: { name: string } | { name: string }[] | null;
  };

  const streaks = ((data ?? []) as Row[]).map((r) => {
    const bankNameRaw = Array.isArray(r.vocab_banks)
      ? r.vocab_banks[0]?.name
      : r.vocab_banks?.name;
    return {
      bankId: r.bank_id,
      bankName: bankNameRaw ?? "",
      count: r.streak_count ?? 0,
      lastDay: r.streak_last_day ?? null,
      maxStreak: r.max_streak ?? 0,
    };
  });

  return NextResponse.json({ streaks });
}
