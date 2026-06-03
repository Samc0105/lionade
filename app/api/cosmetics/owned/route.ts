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
 * Response: { cosmetics: Array<{ id, type, source, acquiredAt }> }
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

  // Fire all three queries in parallel — they're independent and the slowest
  // path determines the response time.
  const [inventoryRes, founderRes, earnedRes] = await Promise.all([
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
  ]);

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

  return NextResponse.json({ cosmetics });
}
