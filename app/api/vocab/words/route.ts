import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { applyFangMultiplier } from "@/lib/mastery-plan";
import {
  isSupportedLang,
  langPairKey,
  normalizeWord,
  normalizeUserDefinition,
  MAX_TRANSLATION_LEN,
} from "@/lib/vocab";

/**
 * POST /api/vocab/words — save a new word
 *
 * Body: {
 *   word: string,
 *   translation: string,
 *   source_lang: 'en'|'es',
 *   target_lang: 'en'|'es',
 *   user_definition?: string
 * }
 *
 * Grants:
 *   +5 Fangs base for the new word
 *   +10 Fangs base if user_definition is non-empty
 *   Both apply the plan multiplier (Pro 1.5x, Platinum 2x) via applyFangMultiplier.
 *
 * Streak: calls advance_vocab_streak RPC after insert. The RPC counts today's
 * inserts for the pair and bumps streak_count the first time the count
 * crosses 5 today.
 *
 * Response: {
 *   word: <row>,
 *   coinsAwarded: number,
 *   streak: { langPair, count, lastDay, bumped } | null,
 *   balance: number | null
 * }
 *
 * GET /api/vocab/words — list user's words
 *
 * Query:
 *   lang=es-en          filter to a single pair (source-target)
 *   due=true            only return rows where next_review_at <= now()
 *   limit=N             default 50, max 200
 *   offset=N            default 0
 *
 * Response: { words: [...], total: number }
 */

const FANG_NEW_WORD = 5;
const FANG_SELF_DEFINE = 10;

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    word,
    translation,
    source_lang,
    target_lang,
    user_definition,
  } = (body ?? {}) as Record<string, unknown>;

  if (!isSupportedLang(source_lang) || !isSupportedLang(target_lang)) {
    return NextResponse.json(
      { error: "Unsupported language. Use 'en' or 'es'." },
      { status: 400 },
    );
  }
  if (source_lang === target_lang) {
    return NextResponse.json(
      { error: "Source and target must differ" },
      { status: 400 },
    );
  }

  const normalizedWord = normalizeWord(word);
  if (!normalizedWord) {
    return NextResponse.json(
      { error: "Word must be 1 to 50 characters" },
      { status: 400 },
    );
  }

  const normalizedTranslation = normalizeWord(translation);
  if (!normalizedTranslation) {
    return NextResponse.json(
      { error: "Translation must be 1 to 50 characters" },
      { status: 400 },
    );
  }
  if (normalizedTranslation.display.length > MAX_TRANSLATION_LEN) {
    return NextResponse.json(
      { error: "Translation is too long" },
      { status: 400 },
    );
  }

  const userDef = normalizeUserDefinition(user_definition);
  const hasUserDef = userDef.length > 0;

  // 1. Insert the vocab word. Initial SR state: ease 2.5, review_count 0,
  //    next_review_at defaults to now() in the schema (due immediately).
  //    The DB enforces UNIQUE (user_id, source_lang, target_lang, lower(word)) —
  //    a duplicate save returns 23505 which we surface as 409.
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("vocab_words")
    .insert({
      user_id: userId,
      word: normalizedWord.display,
      translation: normalizedTranslation.display,
      source_lang,
      target_lang,
      user_definition: hasUserDef ? userDef : null,
    })
    .select("*")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json(
        { error: "You already saved this word" },
        { status: 409 },
      );
    }
    console.error("[vocab/words POST insert]", insertErr.message);
    return NextResponse.json({ error: "Couldn't save word" }, { status: 500 });
  }

  // 2. Grant Fangs (multiplier-aware). +5 base for the word; +10 base if the
  //    user wrote their own definition. If the credit fails, refund the row
  //    so we don't leave a phantom card.
  const baseFangs = FANG_NEW_WORD + (hasUserDef ? FANG_SELF_DEFINE : 0);
  const boostedFangs = await applyFangMultiplier(baseFangs, userId, supabaseAdmin);

  if (boostedFangs > 0) {
    const { error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
      p_user_id: userId,
      p_delta: boostedFangs,
      p_min_balance: 0,
      p_source: "cashable",
    });
    if (creditErr) {
      console.error("[vocab/words POST credit]", creditErr.message);
      await supabaseAdmin.from("vocab_words").delete().eq("id", inserted.id);
      return NextResponse.json({ error: "Couldn't update balance" }, { status: 500 });
    }

    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: boostedFangs,
      type: "vocab_save",
      reference_id: String(inserted.id),
      description: hasUserDef
        ? `Saved vocab: ${normalizedWord.display} (with definition)`
        : `Saved vocab: ${normalizedWord.display}`,
    });
  }

  // 3. Streak advance via RPC. The RPC handles "is today's count >= 5" and
  //    yesterday→today / gap rules server-side. Non-fatal: streak failure
  //    must never break a vocab save.
  let streakOut: {
    langPair: string;
    count: number;
    lastDay: string | null;
    bumped: boolean;
  } | null = null;
  try {
    const { data: streakRows, error: streakErr } = await supabaseAdmin.rpc(
      "advance_vocab_streak",
      {
        p_user_id: userId,
        p_source_lang: source_lang,
        p_target_lang: target_lang,
      },
    );
    if (streakErr) {
      console.error("[vocab/words POST streak]", streakErr.message);
    } else if (Array.isArray(streakRows) && streakRows.length > 0) {
      const row = streakRows[0] as {
        streak_count: number;
        streak_last_day: string | null;
        max_streak: number;
        bumped: boolean;
      };
      streakOut = {
        langPair: langPairKey(source_lang, target_lang),
        count: row.streak_count ?? 0,
        lastDay: row.streak_last_day,
        bumped: !!row.bumped,
      };
    }
  } catch (err) {
    console.error("[vocab/words POST streak exception]", err);
  }

  // 4. Return final balance.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("coins")
    .eq("id", userId)
    .single();

  return NextResponse.json({
    word: inserted,
    coinsAwarded: boostedFangs,
    streak: streakOut,
    balance: profile?.coins ?? null,
  });
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { searchParams } = new URL(req.url);
  const lang = searchParams.get("lang");
  const due = searchParams.get("due") === "true";
  const limitRaw = Number(searchParams.get("limit") ?? 50);
  const offsetRaw = Number(searchParams.get("offset") ?? 0);

  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);

  let query = supabaseAdmin
    .from("vocab_words")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order(due ? "next_review_at" : "created_at", { ascending: due })
    .range(offset, offset + limit - 1);

  if (lang) {
    // Expect "source-target" e.g. "es-en"
    const parts = lang.split("-");
    if (parts.length !== 2 || !isSupportedLang(parts[0]) || !isSupportedLang(parts[1])) {
      return NextResponse.json({ error: "Invalid lang filter" }, { status: 400 });
    }
    query = query.eq("source_lang", parts[0]).eq("target_lang", parts[1]);
  }

  if (due) {
    query = query.lte("next_review_at", new Date().toISOString());
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[vocab/words GET]", error.message);
    return NextResponse.json({ error: "Couldn't load words" }, { status: 500 });
  }

  return NextResponse.json({ words: data ?? [], total: count ?? 0 });
}
