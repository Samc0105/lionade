/**
 * POST /api/user/login-event
 *
 * Settings overhaul 2026-06-11 — records one user_login_events row for the
 * caller after a successful sign-in. The user_agent is read server-side from
 * the request header (never trusted from the body), and the row is written
 * with the service-role client.
 *
 * Idempotency: a single login can fire this from multiple effects (the login
 * page + an auth-state listener). To avoid a burst of duplicate rows we skip
 * the insert if the caller's most recent event is < 60s old.
 *
 * Auth: requireAuth. Always scoped to auth.userId.
 *
 * Fire-and-forget from the client — a failure here must never block login, so
 * the route always returns 200-ish quickly and the caller ignores the result.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const DEDUPE_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // Dedupe a client burst: if the most recent event is younger than the
  // window, treat this as a no-op success.
  const { data: recent, error: recentErr } = await supabaseAdmin
    .from("user_login_events")
    .select("created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentErr) {
    console.error("[api/user/login-event] recent lookup", recentErr.message);
    // Fall through and attempt the insert — under-logging is fine, but don't
    // hard-fail the caller over a read hiccup.
  } else if (recent?.created_at) {
    const ageMs = Date.now() - new Date(recent.created_at as string).getTime();
    if (ageMs >= 0 && ageMs < DEDUPE_WINDOW_MS) {
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  // user_agent comes from the header, capped so a hostile client can't bloat
  // the row. Never trusted for anything beyond display parsing.
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 512) || null;

  const { error } = await supabaseAdmin
    .from("user_login_events")
    .insert({ user_id: userId, user_agent: userAgent });

  if (error) {
    console.error("[api/user/login-event]", error.message);
    return NextResponse.json({ error: "Failed to record login" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
