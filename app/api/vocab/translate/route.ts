import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  isSupportedLang,
  normalizeWord,
} from "@/lib/vocab";

/**
 * POST /api/vocab/translate
 *
 * Body: { word: string, source: 'en'|'es', target: 'en'|'es' }
 *
 * Proxies the free MyMemory Translation API with an aggressive server-side
 * cache so we never burn the same quota character twice.
 *
 * Quota note: MyMemory free tier is 5k chars/day per IP, bumped to 50k when
 * `de=<email>` is supplied (anonymous identifier — they don't email you).
 * Combined with the cache + 30/min IP rate limit (middleware) + 50-char input
 * cap, a single user maxing out the slider would still take ~hours of unique
 * words to hit the ceiling.
 *
 * Response: { translation: string, cached: boolean }
 * Errors:
 *   400 invalid body
 *   401 unauthenticated (requireAuth)
 *   429 rate limited (middleware)
 *   503 MyMemory timeout / upstream error
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { word, source, target } = (body ?? {}) as {
    word?: unknown;
    source?: unknown;
    target?: unknown;
  };

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
    // Fire-and-forget last_hit_at bookkeeping — we don't await it because the
    // user-visible response shouldn't wait on a metric write. We skip the
    // hits++ counter on purpose: a read-modify-write would race other hits
    // for the same word, and the metric isn't load-bearing.
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

    // MyMemory uses 200 + a "responseStatus" inside the body for app errors.
    if (!text || (data.responseStatus && data.responseStatus !== 200)) {
      console.error("[vocab/translate] MyMemory bad payload", data.responseStatus);
      return NextResponse.json(
        { error: "Translation unavailable, try again" },
        { status: 503 },
      );
    }

    translation = text;
  } catch (err) {
    // Timeout or network error — never leak the exception.
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
