import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/cosmetics/owned
 *
 * Aggregates a user's owned cosmetics across THREE backing tables and returns
 * a single flat list keyed by cosmetic id. This is the canonical source the
 * profile/equip UI consults when rendering "what does this user own?".
 *
 * Sources:
 *   - user_inventory     — purchased via /api/shop/purchase (Fangs or IAP)
 *   - founder_grants     — granted by founder-badge purchase OR the Stripe
 *                          subscription webhook OR a backfill (auto-grants
 *                          for Lionade OG / Beta Witness)
 *   - earned_cosmetics   — granted by the cosmetic-grant RPCs (polyglot,
 *                          knowledge-sharer, streak-warrior, mastery-medal)
 *
 * The three sources never overlap in normal operation, but if a row exists
 * in more than one (e.g. a manual ops fix), the merge below prefers the
 * `purchased` source first, then `founder`, then `earned`, so the UI never
 * shows the same item twice.
 *
 * Response (stable contract for the frontend useEquippedCosmetics hook):
 *   {
 *     items: Array<{ itemId, itemType, equipped, acquiredAt }>,
 *     equipped: {
 *       effect:      string | null,  // equipped_username_effect
 *       frame:       string | null,  // equipped_frame
 *       name_color:  string | null,  // equipped_name_color
 *       banner:      string | null,  // equipped_banner
 *       avatar_aura: string | null,  // equipped_avatar_aura
 *     },
 *     cosmetics: Array<{ id, type, source, acquiredAt }>  // legacy readers
 *   }
 *
 * `equipped` per item is derived by matching the owned item id against the
 * user's profiles.equipped_* columns (the render source of truth, migration
 * 063 + equipped_username_effect). The resolved `equipped` object is the most
 * robust contract: the hook can read it directly instead of scanning items.
 *
 * Failure mode: each source query is independent. If one fails we log and
 * return what we have from the others — partial data beats a 500 here.
 */

type Source = "purchased" | "founder" | "earned";

interface OwnedCosmetic {
  id: string;
  type: string | null;
  source: Source;
  acquiredAt: string | null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // Fire all queries in parallel — they're independent and the slowest
  // path determines the response time. The profiles row carries the equipped
  // pointers (render source of truth) so each owned item can be flagged.
  const [inventoryRes, founderRes, earnedRes, profileRes] = await Promise.all([
    supabaseAdmin
      .from("user_inventory")
      .select("item_id, item_type, created_at, acquired_at")
      .eq("user_id", userId),
    supabaseAdmin
      .from("founder_grants")
      .select("badge_id, granted_at")
      .eq("user_id", userId),
    supabaseAdmin
      .from("earned_cosmetics")
      .select("cosmetic_id, cosmetic_type, granted_at")
      .eq("user_id", userId),
    supabaseAdmin
      .from("profiles")
      .select("equipped_username_effect, equipped_frame, equipped_name_color, equipped_banner, equipped_avatar_aura")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (profileRes.error) {
    console.error("[cosmetics/owned profile]", profileRes.error.message);
  }

  const prof = (profileRes.data ?? {}) as {
    equipped_username_effect?: string | null;
    equipped_frame?: string | null;
    equipped_name_color?: string | null;
    equipped_banner?: string | null;
    equipped_avatar_aura?: string | null;
  };
  const equipped = {
    effect: prof.equipped_username_effect ?? null,
    frame: prof.equipped_frame ?? null,
    name_color: prof.equipped_name_color ?? null,
    banner: prof.equipped_banner ?? null,
    avatar_aura: prof.equipped_avatar_aura ?? null,
  };
  // Set of equipped item ids for O(1) per-item flagging.
  const equippedIds = new Set(
    Object.values(equipped).filter((v): v is string => typeof v === "string"),
  );

  if (inventoryRes.error) {
    console.error("[cosmetics/owned inventory]", inventoryRes.error.message);
  }
  if (founderRes.error) {
    console.error("[cosmetics/owned founder]", founderRes.error.message);
  }
  if (earnedRes.error) {
    console.error("[cosmetics/owned earned]", earnedRes.error.message);
  }

  // Dedupe by id using priority: purchased > founder > earned.
  // First insert wins (we walk the highest-priority source first).
  const byId = new Map<string, OwnedCosmetic>();

  for (const row of (inventoryRes.data ?? []) as Array<{
    item_id: string;
    item_type: string | null;
    created_at: string | null;
    acquired_at: string | null;
  }>) {
    if (typeof row.item_id !== "string") continue;
    if (byId.has(row.item_id)) continue;
    byId.set(row.item_id, {
      id: row.item_id,
      type: row.item_type ?? null,
      source: "purchased",
      acquiredAt: row.created_at ?? row.acquired_at ?? null,
    });
  }

  for (const row of (founderRes.data ?? []) as Array<{
    badge_id: string;
    granted_at: string | null;
  }>) {
    if (typeof row.badge_id !== "string") continue;
    if (byId.has(row.badge_id)) continue;
    byId.set(row.badge_id, {
      id: row.badge_id,
      type: "founder_badge",
      source: "founder",
      acquiredAt: row.granted_at ?? null,
    });
  }

  for (const row of (earnedRes.data ?? []) as Array<{
    cosmetic_id: string;
    cosmetic_type: string | null;
    granted_at: string | null;
  }>) {
    if (typeof row.cosmetic_id !== "string") continue;
    if (byId.has(row.cosmetic_id)) continue;
    byId.set(row.cosmetic_id, {
      id: row.cosmetic_id,
      type: row.cosmetic_type ?? null,
      source: "earned",
      acquiredAt: row.granted_at ?? null,
    });
  }

  // Sort newest first by acquiredAt (null sorts last).
  const cosmetics = Array.from(byId.values()).sort((a, b) => {
    if (a.acquiredAt === b.acquiredAt) return 0;
    if (a.acquiredAt === null) return 1;
    if (b.acquiredAt === null) return -1;
    return b.acquiredAt.localeCompare(a.acquiredAt);
  });

  // Frontend-facing shape: per-item itemId/itemType/equipped. `equipped` is
  // true when the item id matches one of the profiles.equipped_* pointers.
  const items = cosmetics.map((c) => ({
    itemId: c.id,
    itemType: c.type,
    equipped: equippedIds.has(c.id),
    acquiredAt: c.acquiredAt,
  }));

  return NextResponse.json({ items, equipped, cosmetics });
}
