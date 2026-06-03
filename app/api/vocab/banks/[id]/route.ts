import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  normalizeBankName,
  normalizeColor,
  normalizeIcon,
  type BankRow,
} from "@/lib/vocab-banks";

/**
 * DELETE /api/vocab/banks/[id]
 *
 * Cascades to vocab_words for the bank (ON DELETE CASCADE in schema). Also
 * cascades vocab_streaks rows for the bank. Confirmed intentional: a bank
 * is the unit of grouping; deleting it deletes the cards. UI should confirm
 * the destructive action before calling. Flagged in the vault under
 * Daily/2026-06-03.md.
 *
 * Response: { ok: true }
 *
 *
 * PATCH /api/vocab/banks/[id]
 *
 * Body: { name?: string, color?: string, icon?: string }
 *
 * Does NOT allow editing kind / source_lang / target_lang — those affect
 * the translation/define pipeline + streak grouping, so they're frozen
 * once a bank is created.
 *
 * Response: { bank: BankRow }
 */

type RouteCtx = { params: { id: string } };

// ── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const bankId = ctx.params.id;
  if (!bankId || typeof bankId !== "string") {
    return NextResponse.json({ error: "Missing bank id" }, { status: 400 });
  }

  // Pin user_id in the WHERE clause so an attacker can't delete someone
  // else's bank by guessing an id.
  const { data, error } = await supabaseAdmin
    .from("vocab_banks")
    .delete()
    .eq("id", bankId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[vocab/banks DELETE]", error.message);
    return NextResponse.json({ error: "Couldn't delete bank" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

// ── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const bankId = ctx.params.id;
  if (!bankId || typeof bankId !== "string") {
    return NextResponse.json({ error: "Missing bank id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, color, icon } = (body ?? {}) as Record<string, unknown>;

  // Build patch only with fields the user actually sent. Reject empty patches
  // explicitly so a no-op call doesn't waste an UPDATE.
  const patch: Record<string, string> = {};

  if (name !== undefined) {
    const normalized = normalizeBankName(name);
    if (!normalized) {
      return NextResponse.json(
        { error: "Name must be 1 to 50 characters" },
        { status: 400 },
      );
    }
    patch.name = normalized.display;
    // Slug is intentionally NOT updated — keeps existing shareable URLs stable.
  }

  if (color !== undefined) {
    const normalized = normalizeColor(color);
    if (!normalized) {
      return NextResponse.json(
        { error: "Color must be a hex code like #7CB9E8" },
        { status: 400 },
      );
    }
    patch.color = normalized;
  }

  if (icon !== undefined) {
    const normalized = normalizeIcon(icon);
    if (!normalized) {
      return NextResponse.json({ error: "Invalid icon" }, { status: 400 });
    }
    patch.icon = normalized;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No editable fields supplied" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("vocab_banks")
    .update(patch)
    .eq("id", bankId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[vocab/banks PATCH]", error.message);
    return NextResponse.json({ error: "Couldn't update bank" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });
  }

  return NextResponse.json({ bank: data as BankRow });
}
