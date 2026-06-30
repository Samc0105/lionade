// Batch founder-flair resolver (Shop V2).
//
// founder_grants is RLS-restricted to own rows (founder_grants_select_own), so
// resolving OTHER users' founder badges (for leaderboard rows / social cards)
// MUST run server-side on supabaseAdmin, which bypasses RLS. This does ONE
// query for a whole list of users (no per-row N+1 — founder_grants_user_id_idx
// makes the IN(...) an index scan) and returns the single most-prestigious
// founder badge id per user.

import { supabaseAdmin } from "@/lib/supabase-server";
import { pickTopFounderBadge } from "@/lib/cosmetics/badge-styles";

// Deterministic tie-break: Founding Scholar (paid) and Lionade OG are BOTH
// legendary, so pickTopFounderBadge (which keeps the first-seen badge of the
// max rarity) would otherwise pick non-deterministically depending on row
// order. Ordering candidates by this priority first makes the paid Founding
// Scholar win the tie, then OG, then Beta Witness.
//
// IMPORTANT: any NEW founder badge added to the catalog must be added here too,
// or it falls to the end (priorityIndex returns the array length) and its tie
// resolution becomes data-order-dependent again.
const FOUNDER_PRIORITY = ["badge_founding_scholar", "badge_lionade_og", "badge_beta_witness"];
function priorityIndex(id: string): number {
  const i = FOUNDER_PRIORITY.indexOf(id);
  return i === -1 ? FOUNDER_PRIORITY.length : i;
}

/**
 * Resolve the top founder-badge id for many users in one query. Returns a Map
 * of user_id -> badge id; users with no founder grant are simply absent. Fails
 * soft (returns whatever resolved, empty on error) — this is display-only.
 */
export async function fetchTopFounderFlairByUser(
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const { data, error } = await supabaseAdmin
    .from("founder_grants")
    .select("user_id, badge_id")
    .in("user_id", ids);
  if (error || !data) return out;

  const byUser = new Map<string, string[]>();
  for (const row of data as { user_id: string; badge_id: string }[]) {
    const arr = byUser.get(row.user_id);
    if (arr) arr.push(row.badge_id);
    else byUser.set(row.user_id, [row.badge_id]);
  }

  for (const [uid, badgeIds] of byUser) {
    const ordered = [...badgeIds].sort((a, b) => priorityIndex(a) - priorityIndex(b));
    const top = pickTopFounderBadge(ordered);
    if (top) out.set(uid, top);
  }
  return out;
}
