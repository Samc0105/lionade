/**
 * GET /api/coach/resume/sessions/[id]
 *
 * Returns the full session for the signed-in user. Ownership-only — the
 * `.eq("user_id", userId)` clause matches the RLS policy. Used by the
 * Resume Coach UI when the user navigates back to a previous session
 * or when the page reloads mid-Socratic.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteCtx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const id = params.id;

  const { data, error } = await supabaseAdmin
    .from("resume_coach_sessions")
    .select("id, analysis_json, created_at")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ session: data });
}
