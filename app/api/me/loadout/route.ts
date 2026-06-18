/**
 * /api/me/loadout — cosmetic loadout presets.
 *
 *   GET    list the user's saved presets
 *   POST   create a preset (snapshot of chosen slot ids; name + 5 optional ids)
 *   PATCH  APPLY a preset by id — validates ownership of each referenced id and
 *          writes all 5 profiles.equipped_* columns in ONE atomic update
 *   DELETE remove a preset (?id=)
 *
 * Presets reference cosmetic ids only. Ownership is NOT checked on save (the
 * catalog can change); it is checked on APPLY. Stale ids (refunded / revoked)
 * are skipped (that slot is left empty) rather than hard-failing the apply, and
 * the skipped ids are reported so the UI can tell the user.
 *
 * Applying writes the protected profiles.equipped_* columns via the service
 * role (the guard_profile_equipped trigger only blocks `authenticated` writes).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";

export const dynamic = "force-dynamic";

const MAX_PRESETS = 8;

// loadout_* (stored on the preset) -> equipped_* (read by the renderers).
const SLOT_MAP = [
  { loadout: "loadout_frame", equipped: "equipped_frame" },
  { loadout: "loadout_avatar_aura", equipped: "equipped_avatar_aura" },
  { loadout: "loadout_name_color", equipped: "equipped_name_color" },
  { loadout: "loadout_banner", equipped: "equipped_banner" },
  { loadout: "loadout_username_effect", equipped: "equipped_username_effect" },
] as const;

const PRESET_COLUMNS =
  "id, name, loadout_frame, loadout_avatar_aura, loadout_name_color, loadout_banner, loadout_username_effect, created_at, updated_at";

const norm = (v: unknown): string | null =>
  typeof v === "string" && v !== "" && v !== "none" ? v : null;

// GET — list presets
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabaseAdmin
    .from("cosmetic_loadouts")
    .select(PRESET_COLUMNS)
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[me/loadout GET]", error.message);
    return NextResponse.json({ loadouts: [] });
  }
  return NextResponse.json({ loadouts: data ?? [] });
}

// POST — create a preset (ownership NOT validated on save; validated on apply)
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  if (isDemoUser(userId)) {
    return NextResponse.json({ error: "Demo accounts can't save looks." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const { count } = await supabaseAdmin
    .from("cosmetic_loadouts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) >= MAX_PRESETS) {
    return NextResponse.json(
      { error: `You can save up to ${MAX_PRESETS} looks. Delete one first.` },
      { status: 409 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("cosmetic_loadouts")
    .insert({
      user_id: userId,
      name,
      loadout_frame: norm(body.frame),
      loadout_avatar_aura: norm(body.avatar_aura),
      loadout_name_color: norm(body.name_color),
      loadout_banner: norm(body.banner),
      loadout_username_effect: norm(body.username_effect),
    })
    .select(PRESET_COLUMNS)
    .single();

  if (error) {
    console.error("[me/loadout POST]", error.message);
    return NextResponse.json({ error: "Couldn't save that look." }, { status: 500 });
  }
  return NextResponse.json({ loadout: data });
}

// PATCH — apply a preset (batch equip with ownership validation)
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  if (isDemoUser(userId)) {
    return NextResponse.json({ error: "Demo accounts can't change cosmetics." }, { status: 403 });
  }

  let body: { id?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: preset } = await supabaseAdmin
    .from("cosmetic_loadouts")
    .select(PRESET_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!preset) return NextResponse.json({ error: "Loadout not found" }, { status: 404 });

  const presetRow = preset as Record<string, string | null>;
  const referenced = SLOT_MAP
    .map((s) => presetRow[s.loadout])
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  // Verify ownership across the 3 sources in one combined query each.
  const ownedSet = new Set<string>();
  if (referenced.length > 0) {
    const [inv, earned, founder] = await Promise.all([
      supabaseAdmin.from("user_inventory").select("item_id").eq("user_id", userId).in("item_id", referenced),
      supabaseAdmin.from("earned_cosmetics").select("cosmetic_id").eq("user_id", userId).in("cosmetic_id", referenced),
      supabaseAdmin.from("founder_grants").select("badge_id").eq("user_id", userId).in("badge_id", referenced),
    ]);
    for (const r of inv.data ?? []) ownedSet.add((r as { item_id: string }).item_id);
    for (const r of earned.data ?? []) ownedSet.add((r as { cosmetic_id: string }).cosmetic_id);
    for (const r of founder.data ?? []) ownedSet.add((r as { badge_id: string }).badge_id);
  }

  // Build the equipped update. A slot gets the preset id IF still owned; a
  // no-longer-owned id is SKIPPED (slot left empty) rather than hard-failing.
  const update: Record<string, string | null> = {};
  const skipped: string[] = [];
  for (const s of SLOT_MAP) {
    const wanted = presetRow[s.loadout];
    if (wanted && ownedSet.has(wanted)) {
      update[s.equipped] = wanted;
    } else {
      if (wanted) skipped.push(wanted);
      update[s.equipped] = null;
    }
  }

  const { error } = await supabaseAdmin.from("profiles").update(update).eq("id", userId);
  if (error) {
    console.error("[me/loadout PATCH] apply:", error.message);
    return NextResponse.json({ error: "Couldn't apply that look." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, equipped: update, skipped });
}

// DELETE — remove a preset (?id=)
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id param" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("cosmetic_loadouts")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId);
  if (error) {
    console.error("[me/loadout DELETE]", error.message);
    return NextResponse.json({ error: "Couldn't delete that look." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
