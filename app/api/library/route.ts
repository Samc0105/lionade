// GET /api/library — browse the Community Study-Set Library.
//
// Query params:
//   - q=...        optional, ilike match on title (metachars escaped, <= 80 chars)
//   - subject=...  optional exact subject filter
//   - set=<uuid>   optional single-set fetch (share-link deep link); when
//                  present all other filters are ignored
//   - limit=30     1..30 (LIBRARY_MAX_LIMIT)
//   - offset=0     >= 0
//
// Ordering: clone_count DESC, published_at DESC (nulls last).
//
// Auth-required like /api/vocab/banks/discover — keeps the feed off
// unauthenticated scrapers and lets the response carry viewer context
// (isMine / clonedByMe). Owner data is joined via service role but ONLY the
// public fields (username, avatar_url) leave the server.
//
// FAIL-SOFT (HELD migrations 20260702130000 + 20260702140000 unapplied): the
// main query fails 42P01/42703 -> 200 { sets: [], unavailable: true } so the
// page renders an honest empty state instead of 500ing.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isMissingLibrarySchema, LIBRARY_UNAVAILABLE_MESSAGE } from "@/lib/library/schema-guard";
import {
  LIBRARY_MAX_LIMIT,
  STUDY_SETS_TABLE,
  type LibrarySetSummary,
} from "@/lib/library/constants";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SetRow {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  subject: string | null;
  card_count: number | null;
  clone_count: number | null;
  published_at: string | null;
}

function parseIntParam(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Escape ilike metacharacters so user input matches literally. */
function escapeIlike(raw: string): string {
  return raw.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const url = req.nextUrl;
  const singleSetId = url.searchParams.get("set");
  const subject = (url.searchParams.get("subject") ?? "").trim().slice(0, 60);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const limit = parseIntParam(url.searchParams.get("limit"), LIBRARY_MAX_LIMIT, 1, LIBRARY_MAX_LIMIT);
  const offset = parseIntParam(url.searchParams.get("offset"), 0, 0, 100000);

  // card_count is server-maintained by the study-sets routes (recounted on
  // every save/delete), so browse never has to scan study_cards.
  let query = supabaseAdmin
    .from(STUDY_SETS_TABLE)
    .select("id, user_id, title, description, subject, card_count, clone_count, published_at")
    .eq("is_public", true);

  if (singleSetId) {
    if (!UUID_RE.test(singleSetId)) {
      return NextResponse.json({ sets: [] });
    }
    query = query.eq("id", singleSetId).limit(1);
  } else {
    if (subject) query = query.eq("subject", subject);
    if (q) query = query.ilike("title", `%${escapeIlike(q)}%`);
    query = query
      .order("clone_count", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);
  }

  const { data: rows, error: setsErr } = await query;
  if (setsErr) {
    if (isMissingLibrarySchema(setsErr)) {
      // HELD migrations not applied — honest empty feed, never a 500 page.
      return NextResponse.json({
        sets: [],
        unavailable: true,
        message: LIBRARY_UNAVAILABLE_MESSAGE,
      });
    }
    console.error("[library] sets", setsErr.message);
    return NextResponse.json({ error: "Couldn't load the library" }, { status: 500 });
  }

  const setRows = (rows ?? []) as SetRow[];
  if (setRows.length === 0) {
    return NextResponse.json({ sets: [] });
  }

  const setIds = setRows.map((s) => s.id);
  const ownerIds = Array.from(new Set(setRows.map((s) => s.user_id)));

  // Parallel: owner profiles (public fields only) + the viewer's existing
  // clones of anything on this page. Both read-only; each is individually
  // non-fatal so a partial failure degrades instead of erroring.
  const [ownersRes, clonesRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, username, avatar_url").in("id", ownerIds),
    supabaseAdmin
      .from(STUDY_SETS_TABLE)
      .select("cloned_from")
      .eq("user_id", userId)
      .in("cloned_from", setIds),
  ]);

  if (ownersRes.error) console.error("[library] owners", ownersRes.error.message);
  if (clonesRes.error) console.error("[library] viewer clones", clonesRes.error.message);

  const ownerMap = new Map<string, { username: string | null; avatar_url: string | null }>();
  for (const p of (ownersRes.data ?? []) as Array<{
    id: string;
    username: string | null;
    avatar_url: string | null;
  }>) {
    ownerMap.set(p.id, { username: p.username, avatar_url: p.avatar_url });
  }

  const clonedSet = new Set(
    ((clonesRes.data ?? []) as Array<{ cloned_from: string | null }>)
      .map((r) => r.cloned_from)
      .filter((v): v is string => typeof v === "string"),
  );

  const sets: LibrarySetSummary[] = setRows.map((s) => {
    const owner = ownerMap.get(s.user_id);
    return {
      id: s.id,
      title: s.title ?? "Untitled set",
      description: s.description ?? null,
      subject: s.subject ?? null,
      cardCount: s.card_count ?? 0,
      cloneCount: s.clone_count ?? 0,
      publishedAt: s.published_at,
      isMine: s.user_id === userId,
      clonedByMe: clonedSet.has(s.id),
      owner: {
        id: s.user_id,
        username: owner?.username ?? null,
        avatarUrl: owner?.avatar_url ?? null,
      },
    };
  });

  return NextResponse.json({ sets });
}
