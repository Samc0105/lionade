import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isClean } from "@/lib/moderation";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
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
 * the destructive action before calling.
 *
 * Response: { ok: true }
 *
 *
 * PATCH /api/vocab/banks/[id]
 *
 * Body: { name?, color?, icon?, is_public? }
 *
 * Does NOT allow editing kind / source_lang / target_lang — frozen at create.
 *
 * Publish (is_public=true) rules — V3A:
 *   - bank name must pass the profanity denylist (lib/moderation.isClean)
 *   - user may have at most MAX_PUBLIC_BANKS public banks at once (anti-spam)
 *   - published_at is set to now() on first publish OR re-publish (was-false→true)
 *
 * Unpublish (is_public=false) leaves published_at as-is. We don't NULL it,
 * because clone_count etc. stay meaningful between publish toggles.
 *
 * Response: { bank: BankRow }
 */

type RouteCtx = { params: { id: string } };

const MAX_PUBLIC_BANKS = 20;

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

  const { name, color, icon, is_public } = (body ?? {}) as Record<string, unknown>;

  // Build patch only with fields the user actually sent. Reject empty patches
  // explicitly so a no-op call doesn't waste an UPDATE.
  const patch: Record<string, string | boolean | null> = {};

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

  // ── Publish toggle ───────────────────────────────────────────────────────
  // is_public must be a boolean (not truthy). Anything else is rejected so
  // the caller doesn't silently set false via undefined/string.
  let publishing = false;
  if (is_public !== undefined) {
    if (typeof is_public !== "boolean") {
      return NextResponse.json(
        { error: "is_public must be true or false" },
        { status: 400 },
      );
    }
    patch.is_public = is_public;
    publishing = is_public === true;
  }

  // Shared demo account: PUBLISHING a bank to Discover is the only
  // mutation here that affects other users (private edits to the demo's
  // own banks are fine — they show up in the demo). Block public-publish
  // attempts so testers can't push abusive or pranked bank names onto the
  // public Discover surface under the shared account.
  if (publishing && isDemoUser(userId)) return demoBlockedResponse();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No editable fields supplied" },
      { status: 400 },
    );
  }

  // ── Publish-only validation ──────────────────────────────────────────────
  // We need the existing bank row when publishing so we can:
  //   1) profanity-check the FINAL name (whether incoming or stored),
  //   2) decide whether published_at must be (re)stamped (null OR was false),
  //   3) verify the cap excluding THIS bank if it's already public.
  if (publishing) {
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("vocab_banks")
      .select("id, name, is_public, published_at")
      .eq("id", bankId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existErr) {
      console.error("[vocab/banks PATCH publish-fetch]", existErr.message);
      return NextResponse.json({ error: "Couldn't load bank" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Bank not found" }, { status: 404 });
    }

    // Final name = incoming patch.name (if any) else stored.
    const finalName = typeof patch.name === "string" ? patch.name : existing.name;
    if (!isClean(finalName)) {
      return NextResponse.json(
        {
          error:
            "Bank name contains language we can't publish. Rename it and try again.",
        },
        { status: 400 },
      );
    }

    // Cap check — only when transitioning false→true. If already public, the
    // user isn't increasing their public count.
    if (!existing.is_public) {
      const { count, error: countErr } = await supabaseAdmin
        .from("vocab_banks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_public", true);

      if (countErr) {
        console.error("[vocab/banks PATCH publish-count]", countErr.message);
        return NextResponse.json(
          { error: "Couldn't check your public bank count" },
          { status: 500 },
        );
      }
      if ((count ?? 0) >= MAX_PUBLIC_BANKS) {
        return NextResponse.json(
          {
            error: `You can have up to ${MAX_PUBLIC_BANKS} public banks. Make one private first.`,
          },
          { status: 400 },
        );
      }
    }

    // published_at: stamp NOW if it's null OR if we're flipping false→true.
    // Re-publishing after a private interlude refreshes the timestamp so the
    // bank appears in the "new" feed again — design choice, mirrors how
    // Reddit handles repost timestamps. If already public, leave as-is.
    if (!existing.is_public || existing.published_at == null) {
      patch.published_at = new Date().toISOString();
    }
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
