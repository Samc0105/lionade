/**
 * POST /api/me/equip
 *
 * Equip a cosmetic the user owns. Slot-based: each cosmetic type occupies
 * one slot at a time (one username_effect, one banner, one frame, etc).
 * Equipping a new cosmetic in a slot unequips whatever was there.
 *
 * Body: { slot: 'username_effect' | 'banner' | 'frame' | 'background' |
 *         'name_color' | 'avatar_aura' | 'voice_skin',
 *         cosmetic_id: string }
 *
 * Auth: requireAuth. Ownership: verifies the user actually owns the
 * cosmetic via user_inventory + earned_cosmetics + founder_grants.
 * Demo user: blocked from equip (would let the publicly-known demo
 * account get re-styled by anyone).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";

const VALID_SLOTS = [
  "username_effect",
  "banner",
  "animated_banner",
  "frame",
  "background",
  "name_color",
  "avatar_aura",
  "voice_skin",
] as const;
type Slot = (typeof VALID_SLOTS)[number];

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (isDemoUser(userId)) {
    return NextResponse.json(
      { error: "Demo accounts can't change cosmetics. Sign up to try it for real." },
      { status: 403 },
    );
  }

  let body: { slot?: unknown; cosmetic_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slot = typeof body.slot === "string" ? body.slot : "";
  // Bucket C 2026-06-05: empty string OR explicit null on cosmetic_id is now
  // a valid "unequip this slot" signal. Backed by the new Shop unequip CTA.
  const rawId = body.cosmetic_id;
  const cosmeticId =
    typeof rawId === "string" ? rawId :
    rawId === null ? "" :
    undefined;

  if (!VALID_SLOTS.includes(slot as Slot)) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }
  if (cosmeticId === undefined) {
    return NextResponse.json({ error: "Missing cosmetic_id" }, { status: 400 });
  }

  // ── Unequip path ──
  // Empty/null cosmetic_id clears the slot. Currently only username_effect
  // has a dedicated column on profiles; other slots clear all `equipped=true`
  // rows of the matching item_type in user_inventory.
  if (!cosmeticId) {
    if (slot === "username_effect") {
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ equipped_username_effect: null })
        .eq("id", userId);
      if (error) {
        console.error("[me/equip] username_effect unequip:", error.message);
        return NextResponse.json({ error: "Failed to unequip" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, slot, cosmetic_id: null });
    }
    // Generic slot unequip: clear `equipped=true` rows of this item_type.
    // Slot names map 1:1 to item_type for the simple cases.
    const itemType = slot === "animated_banner" ? "animated_banner"
                   : slot === "banner"          ? "banner"
                   : slot === "frame"           ? "frame"
                   : slot === "background"      ? "background"
                   : slot === "name_color"      ? "name_color"
                   : slot === "avatar_aura"     ? "frame" // auras are frame-typed in the catalog
                   : slot === "voice_skin"      ? "frame"
                   : null;
    if (itemType) {
      await supabaseAdmin
        .from("user_inventory")
        .update({ equipped: false })
        .eq("user_id", userId)
        .eq("item_type", itemType);
    }
    return NextResponse.json({ ok: true, slot, cosmetic_id: null });
  }

  // Ownership check — cosmetic must exist in one of: user_inventory,
  // earned_cosmetics, founder_grants. Single OR query against all three
  // sources so the user can equip purchased / earned / founder items.
  const [inv, earned, founder] = await Promise.all([
    supabaseAdmin
      .from("user_inventory")
      .select("id")
      .eq("user_id", userId)
      .eq("item_id", cosmeticId)
      .maybeSingle(),
    supabaseAdmin
      .from("earned_cosmetics")
      .select("id")
      .eq("user_id", userId)
      .eq("cosmetic_id", cosmeticId)
      .maybeSingle(),
    supabaseAdmin
      .from("founder_grants")
      .select("id")
      .eq("user_id", userId)
      .eq("badge_id", cosmeticId)
      .maybeSingle(),
  ]);

  const owned = Boolean(inv.data ?? earned.data ?? founder.data);
  if (!owned) {
    return NextResponse.json(
      { error: "You don't own this cosmetic" },
      { status: 403 },
    );
  }

  // Special-case the most common slot (username_effect) by writing to a
  // dedicated profiles.equipped_username_effect column. Other slots use
  // the user_inventory.equipped flag (existing pattern) but only when
  // the cosmetic is in user_inventory — earned + founder badges have
  // their own display logic on the profile page.
  if (slot === "username_effect") {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ equipped_username_effect: cosmeticId })
      .eq("id", userId);
    if (error) {
      console.error("[me/equip] username_effect update:", error.message);
      return NextResponse.json({ error: "Failed to equip" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, slot, cosmetic_id: cosmeticId });
  }

  // Generic slot — unequip everything else of the same type in inventory,
  // then equip this one. Earned + founder cosmetics aren't tracked in
  // user_inventory so this is a no-op for them; the equip-state for
  // those slots will follow in a V3 schema if Sam wants per-slot equip
  // tracking for earned items.
  if (inv.data) {
    // Find this item's type to scope the unequip
    const { data: catalogItem } = await supabaseAdmin
      .from("user_inventory")
      .select("item_type")
      .eq("user_id", userId)
      .eq("item_id", cosmeticId)
      .single();
    const itemType = catalogItem?.item_type ?? null;

    if (itemType) {
      // Unequip all other items of the same type in this user's inventory
      await supabaseAdmin
        .from("user_inventory")
        .update({ equipped: false })
        .eq("user_id", userId)
        .eq("item_type", itemType)
        .neq("item_id", cosmeticId);
    }
    // Equip this one
    await supabaseAdmin
      .from("user_inventory")
      .update({ equipped: true })
      .eq("user_id", userId)
      .eq("item_id", cosmeticId);
  }

  return NextResponse.json({ ok: true, slot, cosmetic_id: cosmeticId });
}
