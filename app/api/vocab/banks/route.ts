import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  DEFAULT_COLOR,
  DEFAULT_ICON_GENERAL,
  DEFAULT_ICON_LANGUAGE,
  isBankKind,
  normalizeBankName,
  normalizeColor,
  normalizeIcon,
  validateLanguagePair,
  type BankRow,
} from "@/lib/vocab-banks";

/**
 * POST /api/vocab/banks — create a new word bank
 *
 * Body: {
 *   name: string,            // 1..50 chars after trim
 *   kind: 'language'|'general',
 *   source_lang?: 'en'|'es', // required + must differ from target if kind='language'
 *   target_lang?: 'en'|'es', // required if kind='language'
 *   color?: string,          // #RGB or #RRGGBB
 *   icon?: string            // emoji or short token; default depends on kind
 * }
 *
 * Slug: kebab-ASCII of name, dedupe by appending `-2`, `-3`, … on UNIQUE
 * collision (max 25 attempts before bailing with 409).
 *
 * Response: { bank: BankRow }
 *
 *
 * GET /api/vocab/banks — list this user's banks
 *
 * Returns: { banks: BankRow[] }
 * Sort: most-recently-active first (latest vocab_words.created_at per bank,
 *       NULL last-active sorts after banks with at least one word).
 */

const MAX_SLUG_TRIES = 25;

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
    name,
    kind,
    source_lang,
    target_lang,
    color,
    icon,
  } = (body ?? {}) as Record<string, unknown>;

  if (!isBankKind(kind)) {
    return NextResponse.json(
      { error: "kind must be 'language' or 'general'" },
      { status: 400 },
    );
  }

  const normalizedName = normalizeBankName(name);
  if (!normalizedName) {
    return NextResponse.json(
      { error: "Name must be 1 to 50 characters" },
      { status: 400 },
    );
  }

  // Language vs general validation — diverges sharply here.
  let resolvedSource: string | null = null;
  let resolvedTarget: string | null = null;

  if (kind === "language") {
    const pair = validateLanguagePair(source_lang, target_lang);
    if (!pair.ok) {
      return NextResponse.json({ error: pair.error }, { status: 400 });
    }
    resolvedSource = pair.source;
    resolvedTarget = pair.target;
  } else {
    // general — reject any lang fields to keep data integrity tight.
    if (
      (source_lang !== undefined && source_lang !== null) ||
      (target_lang !== undefined && target_lang !== null)
    ) {
      return NextResponse.json(
        { error: "General banks must not include source_lang or target_lang" },
        { status: 400 },
      );
    }
  }

  // Optional color/icon — fall back to defaults if missing OR malformed. We
  // accept-and-default rather than reject so a UI bug doesn't block creation.
  const finalColor = color === undefined ? DEFAULT_COLOR : normalizeColor(color) ?? DEFAULT_COLOR;
  const fallbackIcon = kind === "language" ? DEFAULT_ICON_LANGUAGE : DEFAULT_ICON_GENERAL;
  const finalIcon = icon === undefined ? fallbackIcon : normalizeIcon(icon) ?? fallbackIcon;

  // Slug collision loop. UNIQUE (user_id, slug) in schema; on 23505 we bump
  // the suffix and retry. Bounded to MAX_SLUG_TRIES so a pathological name
  // (e.g. a user with 25 banks all named "Notes") can't hang us forever.
  const baseSlug = normalizedName.slugBase;
  let inserted: BankRow | null = null;
  let lastErr: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < MAX_SLUG_TRIES; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const { data, error } = await supabaseAdmin
      .from("vocab_banks")
      .insert({
        user_id: userId,
        name: normalizedName.display,
        slug,
        kind,
        source_lang: resolvedSource,
        target_lang: resolvedTarget,
        color: finalColor,
        icon: finalIcon,
      })
      .select("*")
      .single();
    if (!error && data) {
      inserted = data as BankRow;
      break;
    }
    lastErr = { code: error?.code, message: error?.message ?? "unknown" };
    if (error?.code !== "23505") break; // not a unique-violation — give up
  }

  if (!inserted) {
    console.error("[vocab/banks POST insert]", lastErr?.code, lastErr?.message);
    if (lastErr?.code === "23505") {
      return NextResponse.json(
        { error: "Couldn't pick a unique slug. Try a different name." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Couldn't create bank" }, { status: 500 });
  }

  return NextResponse.json({ bank: inserted });
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // Pull banks + a single aggregate column (latest word created_at) so we
  // can sort by activity without a second round trip per bank.
  const { data: banks, error: banksErr } = await supabaseAdmin
    .from("vocab_banks")
    .select("*")
    .eq("user_id", userId);

  if (banksErr) {
    console.error("[vocab/banks GET]", banksErr.message);
    return NextResponse.json({ error: "Couldn't load banks" }, { status: 500 });
  }

  const bankRows = (banks ?? []) as BankRow[];
  if (bankRows.length === 0) {
    return NextResponse.json({ banks: [] });
  }

  // Fetch latest activity per bank. One query — bank_id grouped via the row
  // shape we get back (Supabase JS doesn't expose group-by; we fetch the
  // latest per-bank by ordering and slicing client-side via a Map).
  const bankIds = bankRows.map((b) => b.id);
  const { data: latest, error: latestErr } = await supabaseAdmin
    .from("vocab_words")
    .select("bank_id, created_at")
    .in("bank_id", bankIds)
    .order("created_at", { ascending: false });

  if (latestErr) {
    // Non-fatal — fall back to created_at sort.
    console.error("[vocab/banks GET latest]", latestErr.message);
  }

  const latestByBank = new Map<string, string>();
  for (const row of (latest ?? []) as Array<{ bank_id: string; created_at: string }>) {
    if (!latestByBank.has(row.bank_id)) latestByBank.set(row.bank_id, row.created_at);
  }

  const sorted = [...bankRows].sort((a, b) => {
    const aT = latestByBank.get(a.id) ?? a.created_at;
    const bT = latestByBank.get(b.id) ?? b.created_at;
    // Banks with no words use created_at — keeps fresh-empty banks visible
    // but a bank with recent activity wins.
    return bT.localeCompare(aT);
  });

  return NextResponse.json({ banks: sorted });
}
