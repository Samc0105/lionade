import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import type { BankRow } from "@/lib/vocab-banks";

/**
 * GET /api/vocab/banks/[id]/preview
 *
 * Auth-required. Returns the public bank's metadata + the first N words so
 * users can preview before committing to a clone.
 *
 * 403 if the bank is not public — owners use the regular bank GET endpoint
 * for their own banks. We treat private + nonexistent identically (return
 * 404) to avoid leaking the existence of someone else's private bank id.
 *
 * Query param: ?n=5 (clamped 1..20, default 5)
 *
 * Response: { bank: BankRow, words: VocabWord[] }
 */

type RouteCtx = { params: { id: string } };

const DEFAULT_N = 5;
const MAX_N = 20;

function parseN(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_N;
  return Math.min(n, MAX_N);
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  // No userId needed beyond authentication — preview is the same for all
  // authed users. Permissions logic is purely is_public.

  const bankId = ctx.params.id;
  if (!bankId || typeof bankId !== "string") {
    return NextResponse.json({ error: "Missing bank id" }, { status: 400 });
  }

  const n = parseN(req.nextUrl.searchParams.get("n"));

  const { data: bank, error: bankErr } = await supabaseAdmin
    .from("vocab_banks")
    .select("*")
    .eq("id", bankId)
    .maybeSingle();

  if (bankErr) {
    console.error("[vocab/banks/preview bank]", bankErr.message);
    return NextResponse.json({ error: "Couldn't load preview" }, { status: 500 });
  }
  if (!bank) {
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });
  }

  const bankRow = bank as BankRow;
  if (!bankRow.is_public) {
    // Collapse private-but-exists to 404 to avoid leaking the id.
    return NextResponse.json({ error: "Bank not found" }, { status: 404 });
  }

  // Words — order by created_at ASC so the preview reflects the author's
  // intended teaching order (first added → first shown).
  const { data: words, error: wordsErr } = await supabaseAdmin
    .from("vocab_words")
    .select("*")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: true })
    .limit(n);

  if (wordsErr) {
    console.error("[vocab/banks/preview words]", wordsErr.message);
    return NextResponse.json({ error: "Couldn't load preview" }, { status: 500 });
  }

  return NextResponse.json({ bank: bankRow, words: words ?? [] });
}
