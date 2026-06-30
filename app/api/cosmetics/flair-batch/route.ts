/**
 * POST /api/cosmetics/flair-batch  { userIds: string[] } -> { flair: Record<userId, badgeId> }
 *
 * Resolves the public founder-badge flair for a set of users so the leaderboard
 * (a client component using the anon Supabase client, which cannot read other
 * users' RLS-protected founder_grants) can render the pill. Founder badges are
 * a public flex by design; this is READ-ONLY and grants nothing. Auth-gated so
 * it can't be scraped anonymously, and the leaderboard only ever sends the ids
 * it already renders (already filtered to public, non-opted-out profiles).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { fetchTopFounderFlairByUser } from "@/lib/cosmetics/founder-flair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 250;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const raw = (body as { userIds?: unknown }).userIds;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "userIds must be an array" }, { status: 400 });
  }

  const userIds = raw.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS);
  const map = await fetchTopFounderFlairByUser(userIds);
  return NextResponse.json({ flair: Object.fromEntries(map) });
}
