/**
 * GET /api/user/sessions
 *
 * Settings overhaul 2026-06-11 — Data & Usage > Session history.
 *
 * Returns the caller's last 10 login events (newest first) with the stored
 * user_agent parsed server-side into a coarse device + browser label. This is
 * a display-only convenience log backed by user_login_events — Supabase Auth
 * still owns the real session lifecycle.
 *
 * Contract (FROZEN — consumed by the Account section too):
 *   { ok: true, sessions: Array<{ id, device, browser, created_at }> }
 *
 * Auth: requireAuth. Always scoped to auth.userId — never trust an input id.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { parseDevice, parseBrowser } from "@/lib/ua-parse";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data, error } = await supabaseAdmin
    .from("user_login_events")
    .select("id, user_agent, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[api/user/sessions]", error.message);
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
  }

  const sessions = (data ?? []).map((row) => ({
    id: row.id as string,
    device: parseDevice(row.user_agent as string | null),
    browser: parseBrowser(row.user_agent as string | null),
    created_at: row.created_at as string,
  }));

  return NextResponse.json({ ok: true, sessions });
}
