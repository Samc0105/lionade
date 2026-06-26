import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";

// Returns the signed-in player's shift completions (best score per shift), so
// the campaign can show cross-device progress once the held migration is live.
// Until then it returns an empty set and the client falls back to localStorage.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabaseAdmin
    .from("techhub_shift_completions")
    .select("shift_id, best_score, last_csat, plays")
    .eq("user_id", auth.userId);

  if (error) {
    if (error.code === "42P01" || /relation .* does not exist/i.test(error.message)) {
      return NextResponse.json({ completions: [], pending: true });
    }
    return NextResponse.json({ error: "Couldn't load completions." }, { status: 500 });
  }

  return NextResponse.json({ completions: data ?? [] });
}
