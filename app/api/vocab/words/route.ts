import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { assertFeatureLive } from "@/lib/feature-flags";
import { recordFeatureError } from "@/lib/feature-health";
import { applyFangMultiplier } from "@/lib/mastery-plan";
import { moderateText, logFlagged } from "@/lib/moderation-ugc";
import { awardBadges } from "@/lib/badges";
import {
  isSupportedLang,
  normalizeWord,
  normalizeUserDefinition,
  MAX_TRANSLATION_LEN,
} from "@/lib/vocab";
import {
  isDefinitionSource,
  normalizeTerm,
  type BankRow,
  type DefinitionSource,
} from "@/lib/vocab-banks";

/**
 * POST /api/vocab/words — save a new word into a bank
 *
 * Required body shape depends on the bank's kind:
 *
 *   Language bank (kind='language'):
 *     {
 *       bank_id: string,
 *       word: string,
 *       translation: string,
 *       source_lang: 'en'|'es',  // must match bank.source_lang
 *       target_lang: 'en'|'es',  // must match bank.target_lang
 *       user_definition?: string
 *     }
 *     -> stored as: word + translation. definition_source = 'mymemory'.
 *
 *   General bank (kind='general'):
 *     {
 *       bank_id: string,
 *       term: string,
 *       term_definition: string,           // canonical definition from Wikipedia/AI/manual
 *       definition_source: 'wikipedia'|'ai'|'manual',
 *       user_definition?: string           // active-recall: user's own explanation
 *     }
 *     -> stored as: word = term, translation = term_definition.
 *
 * Grants:
 *   +5 Fangs base for the new word
 *   +10 Fangs base if user_definition is non-empty
 *   Multiplied by plan tier via applyFangMultiplier.
 *
 * Streak: advance_vocab_streak RPC now keyed by bank_id (was lang-pair in V1).
 */

const FANG_NEW_WORD = 5;
const FANG_SELF_DEFINE = 10;

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // Kill-switch: 503 the save when Vocabulary (or an ancestor) is in
  // maintenance. A 'warning' state is NOT blocked here; the surface stays
  // usable with a banner. Fail-open: an unreadable flag service => allowed.
  const gate = await assertFeatureLive("learn.vocab");
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const bankId = raw.bank_id;
  if (typeof bankId !== "string" || !bankId) {
    return NextResponse.json({ error: "bank_id is required" }, { status: 400 });
  }

  // 1. Load + ownership-check the bank. Single source of truth for kind +
  //    language pair — we don't trust the client to tell us which type to use.
  const { data: bankData, error: bankErr } = await supabaseAdmin
    .from("vocab_banks")
    .select("id, user_id, kind, source_lang, target_lang")
    .eq("id", bankId)
    .eq("user_id", userId)
    .maybeSingle();

  if (bankErr) {
    recordFeatureError("learn.vocab");
    console.error("[vocab/words POST bank read]", bankErr.message);
    return NextResponse.json({ error: "Couldn't load bank" }, { status: 500 });
  }
  if (!bankData) {
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });
  }
  const bank = bankData as Pick<BankRow, "id" | "kind" | "source_lang" | "target_lang">;

  // 2. Per-kind validation + normalization. Both branches end with the same
  //    insert payload shape (word, translation, source_lang, target_lang,
  //    user_definition, definition_source, bank_id).
  let insertPayload: {
    user_id: string;
    bank_id: string;
    word: string;
    translation: string;
    source_lang: string | null;
    target_lang: string | null;
    user_definition: string | null;
    term_definition: string;
    definition_source: DefinitionSource;
  };

  const userDef = normalizeUserDefinition(raw.user_definition);
  const hasUserDef = userDef.length > 0;

  // Moderate the user-authored definition — it surfaces to other users in
  // public bank previews (/api/vocab/banks/[id]/preview). Block + audit on a flag.
  if (hasUserDef) {
    const defMod = await moderateText(userDef);
    if (!defMod.ok) {
      void logFlagged(userId, "vocab_definition", userDef, defMod);
      return NextResponse.json(
        { error: "That definition isn't allowed. Try a different one." },
        { status: 400 },
      );
    }
  }

  if (bank.kind === "language") {
    if (!isSupportedLang(raw.source_lang) || !isSupportedLang(raw.target_lang)) {
      return NextResponse.json(
        { error: "Unsupported language. Use 'en' or 'es'." },
        { status: 400 },
      );
    }
    if (raw.source_lang !== bank.source_lang || raw.target_lang !== bank.target_lang) {
      return NextResponse.json(
        { error: "Language pair does not match this bank" },
        { status: 400 },
      );
    }
    const normalizedWord = normalizeWord(raw.word);
    if (!normalizedWord) {
      return NextResponse.json(
        { error: "Word must be 1 to 50 characters" },
        { status: 400 },
      );
    }
    const normalizedTranslation = normalizeWord(raw.translation);
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
    insertPayload = {
      user_id: userId,
      bank_id: bank.id,
      word: normalizedWord.display,
      translation: normalizedTranslation.display,
      source_lang: bank.source_lang,
      target_lang: bank.target_lang,
      user_definition: hasUserDef ? userDef : null,
      term_definition: normalizedTranslation.display,
      definition_source: "mymemory",
    };
  } else {
    // General bank.
    const normalizedTerm = normalizeTerm(raw.term);
    if (!normalizedTerm) {
      return NextResponse.json(
        { error: "Term must be 1 to 80 characters" },
        { status: 400 },
      );
    }
    const termDefinitionInput =
      typeof raw.term_definition === "string" ? raw.term_definition.trim() : "";
    if (!termDefinitionInput) {
      return NextResponse.json(
        { error: "term_definition is required for general banks" },
        { status: 400 },
      );
    }
    // Cap at 1000 chars — Wikipedia + AI both well under 400; manual users
    // get headroom for a longer pasted definition. We DON'T length-fail; we
    // slice. Better UX than 400-ing a paste.
    const termDefinition = termDefinitionInput.slice(0, 1000);

    const defSource = raw.definition_source;
    if (!isDefinitionSource(defSource) || defSource === "mymemory") {
      return NextResponse.json(
        { error: "definition_source must be wikipedia, ai, or manual" },
        { status: 400 },
      );
    }
    insertPayload = {
      user_id: userId,
      bank_id: bank.id,
      word: normalizedTerm.display,
      translation: termDefinition,
      source_lang: null,
      target_lang: null,
      user_definition: hasUserDef ? userDef : null,
      term_definition: termDefinition,
      definition_source: defSource,
    };
  }

  // 3. Insert. UNIQUE per (user_id, bank_id, lower(word)) — schema-enforced.
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("vocab_words")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json(
        { error: "You already saved this word in this bank" },
        { status: 409 },
      );
    }
    recordFeatureError("learn.vocab");
    console.error("[vocab/words POST insert]", insertErr.message);
    return NextResponse.json({ error: "Couldn't save word" }, { status: 500 });
  }

  // 4. Fang grant — same rules as V1. Refund the row if the credit call fails
  //    so we never leave a phantom card with no balance change.
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
      recordFeatureError("learn.vocab");
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
        ? `Saved vocab: ${insertPayload.word} (with definition)`
        : `Saved vocab: ${insertPayload.word}`,
    });
  }

  // 5. Streak advance — RPC signature is now (p_user_id, p_bank_id). Streak
  //    rows are bank-keyed in V2 so each bank gets its own daily 5-word habit.
  let streakOut: {
    bankId: string;
    count: number;
    lastDay: string | null;
    bumped: boolean;
  } | null = null;
  try {
    const { data: streakRows, error: streakErr } = await supabaseAdmin.rpc(
      "advance_vocab_streak",
      { p_user_id: userId, p_bank_id: bank.id },
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
        bankId: bank.id,
        count: row.streak_count ?? 0,
        lastDay: row.streak_last_day,
        bumped: !!row.bumped,
      };
    }
  } catch (err) {
    console.error("[vocab/words POST streak exception]", err);
  }

  // 5b. Word Collector badge — fires once the lifetime saved-word count hits
  //     10. Fire-and-forget (one head-count + an idempotent upsert inside
  //     lib/badges.ts) so it never delays the save response.
  void (async () => {
    const { count } = await supabaseAdmin
      .from("vocab_words")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    await awardBadges(supabaseAdmin, userId, { wordbankWords: count ?? 0 });
  })().catch((err) => console.warn("[vocab/words POST badge WARN]", err));

  // 6. Final balance.
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

/**
 * GET /api/vocab/words
 *
 * Query:
 *   bank_id=<uuid>    filter to a single bank (must be owned)
 *   due=true          only return cards where next_review_at <= now()
 *   limit=N           default 50, max 200
 *   offset=N          default 0
 *
 * Response: { words: [...], total: number }
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { searchParams } = new URL(req.url);
  const bankId = searchParams.get("bank_id");
  const due = searchParams.get("due") === "true";
  const limitRaw = Number(searchParams.get("limit") ?? 50);
  const offsetRaw = Number(searchParams.get("offset") ?? 0);

  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);

  // .select("*") includes self_confidence — no explicit column list needed.
  let query = supabaseAdmin
    .from("vocab_words")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order(due ? "next_review_at" : "created_at", { ascending: due })
    .range(offset, offset + limit - 1);

  if (bankId) {
    // Ownership check — confirm the bank belongs to the user before filtering,
    // otherwise an attacker could enumerate row counts across all users by
    // probing bank ids.
    const { data: ownership, error: ownErr } = await supabaseAdmin
      .from("vocab_banks")
      .select("id")
      .eq("id", bankId)
      .eq("user_id", userId)
      .maybeSingle();
    if (ownErr) {
      console.error("[vocab/words GET own]", ownErr.message);
      return NextResponse.json({ error: "Couldn't load words" }, { status: 500 });
    }
    if (!ownership) {
      return NextResponse.json({ error: "Bank not found" }, { status: 404 });
    }
    query = query.eq("bank_id", bankId);
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
