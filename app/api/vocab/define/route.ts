import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { callAI, LLM_CHEAP, stripSentinels } from "@/lib/ai";
import { normalizeTerm, type BankRow } from "@/lib/vocab-banks";

/**
 * POST /api/vocab/define
 *
 * Body: { term: string, bank_id: string }
 *
 * Looks up a definition for a general-kind word bank via the cascade:
 *
 *   1. cache (vocab_translations_cache, where source_lang='wikipedia' or 'ai')
 *   2. Wikipedia REST summary (5s timeout) — first sentence of `extract`
 *   3. OpenAI gpt-4o-mini (15s timeout) — 1-2 sentence flashcard definition
 *
 * Each upstream success is cached globally (keyed on lower(term)) so the
 * SAME term across users only ever costs us one Wikipedia + one AI call ever.
 *
 * Cache table contract (existing — translate route already uses it):
 *   word_lower TEXT, source_lang TEXT, target_lang TEXT, translation TEXT
 *   UNIQUE (word_lower, source_lang, target_lang)
 *
 * For define hits, we encode the source in `source_lang` and pin
 * `target_lang = 'def'`. This stays compatible with the existing translate-cache
 * UNIQUE constraint without a schema migration.
 *
 * Response on success: { definition: string, source: 'wikipedia'|'ai', cached: boolean }
 * Response on total miss: 404 { error: "Could not find a definition. Try adding your own." }
 */

const WIKIPEDIA_TIMEOUT_MS = 5_000;
const AI_TIMEOUT_MS = 15_000;
const AI_MAX_TOKENS = 80;
const AI_TEMPERATURE = 0.2;

// Sentinel pinned to keep the existing translate cache schema happy. Define
// rows look like (term_lower, 'wikipedia'|'ai', 'def', definition).
const DEFINE_TARGET_TAG = "def";

// The "first sentence" cutter is intentionally conservative — Wikipedia
// summaries usually open with a clean intro sentence, but we cap at
// ~280 chars just in case `extract` returns a long compound sentence.
const MAX_DEFINITION_LEN = 400;

interface WikipediaSummary {
  type?: string; // "standard" | "disambiguation" | "no-extract" | ...
  extract?: string;
  title?: string;
}

const AI_SYSTEM_PROMPT =
  "You are a study assistant. Define this term in 1-2 clear sentences, " +
  "suitable for flashcard learning. No prefixes like \"X is...\" or \"This term means...\" — " +
  "just the definition itself. Keep it factual and concise.";

function firstSentence(text: string): string {
  // Split on `.` `!` `?` followed by space/EOL, but keep abbreviations sane:
  // we accept anything past 30 chars as a real sentence to avoid ".I.E." traps.
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^.{30,}?[.!?](\s|$)/);
  if (match) return match[0].trim();
  return trimmed.slice(0, MAX_DEFINITION_LEN);
}

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

  const { term, bank_id } = (body ?? {}) as { term?: unknown; bank_id?: unknown };

  if (typeof bank_id !== "string" || !bank_id) {
    return NextResponse.json({ error: "bank_id is required" }, { status: 400 });
  }

  const normalized = normalizeTerm(term);
  if (!normalized) {
    return NextResponse.json(
      { error: "Term must be 1 to 80 characters" },
      { status: 400 },
    );
  }

  // 1. Verify bank ownership + kind.
  const { data: bank, error: bankErr } = await supabaseAdmin
    .from("vocab_banks")
    .select("id, user_id, kind")
    .eq("id", bank_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (bankErr) {
    console.error("[vocab/define bank read]", bankErr.message);
    return NextResponse.json({ error: "Couldn't load bank" }, { status: 500 });
  }
  if (!bank) {
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });
  }
  if ((bank as BankRow).kind !== "general") {
    return NextResponse.json(
      { error: "This bank is a language bank. Use /api/vocab/translate." },
      { status: 400 },
    );
  }

  // 2. Cache lookup. We check 'wikipedia' first since it's the free path —
  //    if a previous miss escalated to AI, that row would be tagged 'ai' and
  //    we return it directly without re-attempting Wikipedia.
  const { data: cacheRows, error: cacheReadErr } = await supabaseAdmin
    .from("vocab_translations_cache")
    .select("source_lang, translation")
    .eq("word_lower", normalized.cacheKey)
    .eq("target_lang", DEFINE_TARGET_TAG)
    .in("source_lang", ["wikipedia", "ai"]);

  if (cacheReadErr) {
    console.error("[vocab/define cache read]", cacheReadErr.message);
    // Fall through to live lookup — cache failure must not block users.
  }

  if (cacheRows && cacheRows.length > 0) {
    // Prefer Wikipedia row if both exist (free + canonical).
    const wikiHit = cacheRows.find((r) => r.source_lang === "wikipedia");
    const aiHit = cacheRows.find((r) => r.source_lang === "ai");
    const hit = wikiHit ?? aiHit;
    if (hit?.translation) {
      void supabaseAdmin
        .from("vocab_translations_cache")
        .update({ last_hit_at: new Date().toISOString() })
        .eq("word_lower", normalized.cacheKey)
        .eq("source_lang", hit.source_lang)
        .eq("target_lang", DEFINE_TARGET_TAG)
        .then(() => {});
      return NextResponse.json({
        definition: hit.translation,
        source: hit.source_lang as "wikipedia" | "ai",
        cached: true,
      });
    }
  }

  // 3. Wikipedia attempt.
  const wikipediaDefinition = await tryWikipedia(normalized.display);
  if (wikipediaDefinition) {
    await writeCache(normalized.cacheKey, "wikipedia", wikipediaDefinition);
    return NextResponse.json({
      definition: wikipediaDefinition,
      source: "wikipedia",
      cached: false,
    });
  }

  // 4. AI fallback. Strip sentinel tags before interpolating into the prompt
  //    (defense-in-depth even though the term is already length-capped and
  //    spaces-normalized).
  const aiDefinition = await tryAI(normalized.display);
  if (aiDefinition) {
    await writeCache(normalized.cacheKey, "ai", aiDefinition);
    return NextResponse.json({
      definition: aiDefinition,
      source: "ai",
      cached: false,
    });
  }

  // 5. Total miss — UI will let the user paste a manual definition.
  return NextResponse.json(
    { error: "Could not find a definition. Try adding your own." },
    { status: 404 },
  );
}

// ── Cascade steps ───────────────────────────────────────────────────────────

async function tryWikipedia(term: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Wikipedia REST policy asks for a contact UA. They DO rate-limit on
        // missing/abusive UAs.
        "User-Agent": "Lionade/1.0 (support@getlionade.com)",
      },
      signal: AbortSignal.timeout(WIKIPEDIA_TIMEOUT_MS),
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      console.error("[vocab/define wikipedia HTTP]", res.status);
      return null;
    }

    const data = (await res.json()) as WikipediaSummary;

    // Reject disambiguation pages — they're a list of "this could mean X / Y"
    // not a real definition. Also reject empty / no-extract responses.
    if (data.type === "disambiguation") return null;
    const extract = (data.extract ?? "").trim();
    if (!extract) return null;

    const sentence = firstSentence(extract);
    if (!sentence) return null;
    return sentence.slice(0, MAX_DEFINITION_LEN);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "TimeoutError";
    console.error("[vocab/define wikipedia]", isAbort ? "timeout" : "fetch failed");
    return null;
  }
}

async function tryAI(term: string): Promise<string | null> {
  const safeTerm = stripSentinels(term);
  try {
    const result = await callAI({
      model: LLM_CHEAP,
      system: AI_SYSTEM_PROMPT,
      userContent: `Term: ${safeTerm}`,
      maxTokens: AI_MAX_TOKENS,
      temperature: AI_TEMPERATURE,
      timeoutMs: AI_TIMEOUT_MS,
    });
    const text = (result.text ?? "").trim();
    if (!text) return null;
    return text.slice(0, MAX_DEFINITION_LEN);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "TimeoutError";
    console.error("[vocab/define ai]", isAbort ? "timeout" : "callAI failed");
    return null;
  }
}

async function writeCache(
  termLower: string,
  source: "wikipedia" | "ai",
  translation: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("vocab_translations_cache")
    .upsert(
      {
        word_lower: termLower,
        source_lang: source,
        target_lang: DEFINE_TARGET_TAG,
        translation,
      },
      { onConflict: "word_lower,source_lang,target_lang" },
    );
  if (error) {
    console.error("[vocab/define cache write]", error.message);
  }
}
