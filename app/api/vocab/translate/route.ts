import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isSupportedLang, normalizeWord } from "@/lib/vocab";
import type { BankRow } from "@/lib/vocab-banks";

/**
 * POST /api/vocab/translate
 *
 * Body: { word: string, source: 'en'|'es', target: 'en'|'es', bank_id: string }
 *
 * Bank-aware as of Word Banks V2:
 *   - The bank must exist + be owned by the user.
 *   - The bank's kind must be 'language' (general banks route to /vocab/define
 *     instead). We surface a 400 with a hint pointing at the right endpoint
 *     if a general bank id slips in.
 *   - We still validate source/target against the V2 allowlist (en, es) so
 *     a malicious client can't bypass that by reusing the bank's stored pair.
 *     The pair MUST also match the bank's stored pair — anything else means
 *     the client is confused.
 *
 * Proxies the free MyMemory Translation API with an aggressive server-side
 * cache so we never burn the same quota character twice.
 *
 * Cache contract: keyed on (word_lower, source_lang='en'|'es', target_lang='en'|'es').
 * General-bank define cache uses (term_lower, source_lang='wikipedia'|'ai',
 * target_lang='def') — see /api/vocab/define. No collision: the source_lang
 * column distinguishes them.
 *
 * Response: { translation: string, cached: boolean }
 */

const MYMEMORY_TIMEOUT_MS = 5000;
const MYMEMORY_CONTACT_EMAIL = "support@getlionade.com";

interface MyMemoryResponse {
  responseStatus?: number;
  responseData?: { translatedText?: string };
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

  const { word, source, target, bank_id } = (body ?? {}) as {
    word?: unknown;
    source?: unknown;
    target?: unknown;
    bank_id?: unknown;
  };

  if (typeof bank_id !== "string" || !bank_id) {
    return NextResponse.json({ error: "bank_id is required" }, { status: 400 });
  }

  if (!isSupportedLang(source) || !isSupportedLang(target)) {
    return NextResponse.json(
      { error: "Unsupported language. Use 'en' or 'es'." },
      { status: 400 },
    );
  }

  if (source === target) {
    return NextResponse.json(
      { error: "Source and target must differ" },
      { status: 400 },
    );
  }

  const normalized = normalizeWord(word);
  if (!normalized) {
    return NextResponse.json(
      { error: "Word must be 1 to 50 characters" },
      { status: 400 },
    );
  }

  // 0. Bank ownership + kind check.
  const { data: bankData, error: bankErr } = await supabaseAdmin
    .from("vocab_banks")
    .select("id, user_id, kind, source_lang, target_lang")
    .eq("id", bank_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (bankErr) {
    console.error("[vocab/translate bank read]", bankErr.message);
    return NextResponse.json({ error: "Couldn't load bank" }, { status: 500 });
  }
  if (!bankData) {
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });
  }
  const bank = bankData as Pick<BankRow, "kind" | "source_lang" | "target_lang">;
  if (bank.kind !== "language") {
    return NextResponse.json(
      { error: "This bank is a general bank. Use /api/vocab/define." },
      { status: 400 },
    );
  }
  // The bank's stored language pair MUST match the request. Prevents a
  // client from cross-translating between unrelated banks.
  if (bank.source_lang !== source || bank.target_lang !== target) {
    return NextResponse.json(
      { error: "Language pair does not match this bank" },
      { status: 400 },
    );
  }

  // 1. Cache lookup — keyed on (word_lower, source, target).
  const { data: cached, error: cacheReadErr } = await supabaseAdmin
    .from("vocab_translations_cache")
    .select("translation")
    .eq("word_lower", normalized.cacheKey)
    .eq("source_lang", source)
    .eq("target_lang", target)
    .maybeSingle();

  if (cacheReadErr) {
    // Read failure is non-fatal — log and fall through to MyMemory.
    console.error("[vocab/translate cache read]", cacheReadErr.message);
  }

  if (cached?.translation) {
    void supabaseAdmin
      .from("vocab_translations_cache")
      .update({ last_hit_at: new Date().toISOString() })
      .eq("word_lower", normalized.cacheKey)
      .eq("source_lang", source)
      .eq("target_lang", target)
      .then(() => {});

    return NextResponse.json({ translation: cached.translation, cached: true });
  }

  // 2. Cache miss — call MyMemory with a 5s timeout.
  const url =
    `https://api.mymemory.translated.net/get` +
    `?q=${encodeURIComponent(normalized.display)}` +
    `&langpair=${source}|${target}` +
    `&de=${encodeURIComponent(MYMEMORY_CONTACT_EMAIL)}`;

  let translation: string | null = null;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(MYMEMORY_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("[vocab/translate] MyMemory HTTP", res.status);
      return NextResponse.json(
        { error: "Translation unavailable, try again" },
        { status: 503 },
      );
    }

    const data = (await res.json()) as MyMemoryResponse;
    const text = data?.responseData?.translatedText?.trim();

    if (!text || (data.responseStatus && data.responseStatus !== 200)) {
      console.error("[vocab/translate] MyMemory bad payload", data.responseStatus);
      return NextResponse.json(
        { error: "Translation unavailable, try again" },
        { status: 503 },
      );
    }

    translation = text;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "TimeoutError";
    console.error("[vocab/translate]", isAbort ? "timeout" : "fetch failed");
    return NextResponse.json(
      { error: "Translation unavailable, try again" },
      { status: 503 },
    );
  }

  // 3. Persist to cache (best-effort — a cache miss next time is recoverable).
  const { error: cacheWriteErr } = await supabaseAdmin
    .from("vocab_translations_cache")
    .upsert(
      {
        word_lower: normalized.cacheKey,
        source_lang: source,
        target_lang: target,
        translation,
      },
      { onConflict: "word_lower,source_lang,target_lang" },
    );
  if (cacheWriteErr) {
    console.error("[vocab/translate cache write]", cacheWriteErr.message);
  }

  return NextResponse.json({ translation, cached: false });
}
