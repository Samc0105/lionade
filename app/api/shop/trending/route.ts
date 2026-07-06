import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * GET /api/shop/trending — returns the top 3 most-purchased SKU ids over the
 * last 7 days, sorted by purchase count desc.
 *
 * Source of truth: `purchase_history` (item_id + purchased_at). We tried
 * `coin_transactions` first but it only logs `description` strings, not ids
 * — `purchase_history` is the structured table the purchase route writes to.
 *
 * Early-days fallback: if `purchase_history` is empty / missing / returns
 * fewer than 3 rows in the window, we return an empty array and let the
 * client hand-pick a fallback set from FEATURED_ITEMS. Keeping the fallback
 * client-side means the trending list stays "live" data only — the server
 * doesn't lie about velocity.
 *
 * Public read — no auth required. Trending is the same for everyone.
 */
export async function GET(_req: NextRequest) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await supabaseAdmin
      .from("purchase_history")
      .select("item_id")
      .gte("purchased_at", sevenDaysAgo);

    if (error) {
      // Table may not exist yet OR be empty — treat as early-days, not a 500.
      // Logged at info level so we know if it's persistently empty.
      console.warn("[shop/trending] purchase_history fetch:", error.message);
      return NextResponse.json({ trending: [] });
    }

    // Tally counts by item_id, sort desc, take top 3.
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      const id = (row as { item_id?: string }).item_id;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const topIds = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);

    return NextResponse.json({ trending: topIds });
  } catch (err) {
    console.error("[shop/trending] unexpected:", err);
    return NextResponse.json({ trending: [] });
  }
}
