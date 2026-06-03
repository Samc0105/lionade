import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import type { BankKind, PublicBankSummary } from "@/lib/vocab-banks";
import { SUPPORTED_LANGS } from "@/lib/vocab";

/**
 * GET /api/vocab/banks/discover
 *
 * Browse PUBLIC vocab banks shared by other users. Auth-required so we can
 * exclude the requester's own banks (no self-cloning) and to keep this off
 * unauthenticated scrapers.
 *
 * Query params:
 *   - sort=top|new|cloned  (default 'top'; 'cloned' is an alias for 'top')
 *       top/cloned: ORDER BY clone_count DESC, published_at DESC
 *       new:        ORDER BY published_at DESC
 *   - kind=language|general          (optional)
 *   - lang=es-en                     (optional; only honored when kind=language —
 *                                     format is "<source>-<target>", both must
 *                                     be in SUPPORTED_LANGS)
 *   - limit=20  (1..50, default 20)
 *   - offset=0  (>=0, default 0)
 *
 * Response: { banks: PublicBankSummary[] }
 *
 * Word counts are computed via one bulk SELECT against vocab_words and
 * stitched in code — Supabase JS doesn't expose a clean group-by for
 * embedded counts on the parent query, and we want to keep this hot path
 * to two round trips.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type SortMode = "top" | "new" | "cloned";

function parseSort(raw: string | null): SortMode {
  if (raw === "new" || raw === "cloned") return raw;
  return "top";
}

function parseLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseOffset(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function parseKind(raw: string | null): BankKind | null {
  if (raw === "language" || raw === "general") return raw;
  return null;
}

function parseLangPair(
  raw: string | null,
): { source: string; target: string } | null {
  if (!raw) return null;
  const parts = raw.split("-");
  if (parts.length !== 2) return null;
  const [source, target] = parts;
  if (!(SUPPORTED_LANGS as readonly string[]).includes(source)) return null;
  if (!(SUPPORTED_LANGS as readonly string[]).includes(target)) return null;
  if (source === target) return null;
  return { source, target };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const url = req.nextUrl;
  const sort = parseSort(url.searchParams.get("sort"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const offset = parseOffset(url.searchParams.get("offset"));
  const kind = parseKind(url.searchParams.get("kind"));
  const langPair = parseLangPair(url.searchParams.get("lang"));

  // Build the main banks query. We never need user_id of the author back
  // because that's already in `author` from the joined profile, but we keep
  // it for the cap/own-bank logic and strip it before responding.
  let query = supabaseAdmin
    .from("vocab_banks")
    .select(
      "id, user_id, name, kind, color, icon, source_lang, target_lang, clone_count, published_at",
    )
    .eq("is_public", true)
    .neq("user_id", userId);

  if (kind) {
    query = query.eq("kind", kind);
    if (kind === "language" && langPair) {
      query = query.eq("source_lang", langPair.source).eq("target_lang", langPair.target);
    }
  }
  // lang without kind=language is silently ignored — language pair only
  // makes sense for language banks and we don't want to error on a frontend
  // that always sets `?lang=...`.

  // Sort. clone_count + published_at DESC for top/cloned; just published_at
  // DESC for new. published_at can be null for legacy rows that flipped
  // is_public=true before the column existed — treat null as oldest.
  if (sort === "new") {
    query = query.order("published_at", { ascending: false, nullsFirst: false });
  } else {
    query = query
      .order("clone_count", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false });
  }

  query = query.range(offset, offset + limit - 1);

  const { data: banks, error: banksErr } = await query;
  if (banksErr) {
    console.error("[vocab/banks/discover banks]", banksErr.message);
    return NextResponse.json({ error: "Couldn't load discover" }, { status: 500 });
  }

  const bankRows = (banks ?? []) as Array<{
    id: string;
    user_id: string;
    name: string;
    kind: BankKind;
    color: string;
    icon: string;
    source_lang: string | null;
    target_lang: string | null;
    clone_count: number | null;
    published_at: string | null;
  }>;

  if (bankRows.length === 0) {
    return NextResponse.json({ banks: [] as PublicBankSummary[] });
  }

  const bankIds = bankRows.map((b) => b.id);
  const authorIds = Array.from(new Set(bankRows.map((b) => b.user_id)));

  // Parallel: author profiles + per-bank word counts. Both are read-only.
  const [authorsRes, wordsRes] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", authorIds),
    supabaseAdmin
      .from("vocab_words")
      .select("bank_id")
      .in("bank_id", bankIds),
  ]);

  if (authorsRes.error) {
    console.error("[vocab/banks/discover authors]", authorsRes.error.message);
    // Non-fatal: we still want to render the page even if usernames are missing.
  }
  if (wordsRes.error) {
    console.error("[vocab/banks/discover words]", wordsRes.error.message);
    // Non-fatal: counts default to 0.
  }

  const authorMap = new Map<string, { username: string | null; avatar_url: string | null }>();
  for (const p of (authorsRes.data ?? []) as Array<{
    id: string;
    username: string | null;
    avatar_url: string | null;
  }>) {
    authorMap.set(p.id, { username: p.username, avatar_url: p.avatar_url });
  }

  const wordCountMap = new Map<string, number>();
  for (const row of (wordsRes.data ?? []) as Array<{ bank_id: string }>) {
    wordCountMap.set(row.bank_id, (wordCountMap.get(row.bank_id) ?? 0) + 1);
  }

  const out: PublicBankSummary[] = bankRows.map((b) => {
    const author = authorMap.get(b.user_id);
    return {
      id: b.id,
      name: b.name,
      kind: b.kind,
      color: b.color,
      icon: b.icon,
      source_lang: (b.source_lang as PublicBankSummary["source_lang"]) ?? null,
      target_lang: (b.target_lang as PublicBankSummary["target_lang"]) ?? null,
      clone_count: b.clone_count ?? 0,
      published_at: b.published_at,
      word_count: wordCountMap.get(b.id) ?? 0,
      author: {
        id: b.user_id,
        username: author?.username ?? null,
        avatar_url: author?.avatar_url ?? null,
      },
    };
  });

  return NextResponse.json({ banks: out });
}
