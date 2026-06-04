// POST /api/presence/heartbeat — every active client pings this every ~10s.
//
// Body: { type?: string, id?: string }
//   type/id are optional — when present they describe the session the user
//   thinks they're in. They're persisted by `ping_presence` so the AFK
//   reaper can correlate (active_session_type / active_session_id) without
//   re-reading profiles.active_session for every row.
//
// This route is intentionally CHEAP. It does one RPC call and returns. No
// joins, no Fang mutations, no email sends. Rate limit is enforced in
// middleware at 30/min/IP — plenty for the 10s cadence with a small burst
// allowance.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

const ALLOWED_TYPES = new Set([
  "party_room",
  "arena_match",
  "competitive_match",
  "mastery_session",
  "daily_drill",
  "quiz",
]);

const MAX_ID_LEN = 128;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let typeArg: string | null = null;
  let idArg: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.type === "string" && ALLOWED_TYPES.has(body.type)) {
      typeArg = body.type;
    }
    if (typeof body?.id === "string" && body.id.length > 0 && body.id.length <= MAX_ID_LEN) {
      idArg = body.id;
    }
  } catch {
    // Body parse failures fall through — heartbeat can still ping with NULL type/id.
  }

  try {
    const { error } = await supabaseAdmin.rpc("ping_presence", {
      p_user_id: userId,
      p_type: typeArg,
      p_id: idArg,
    });
    if (error) {
      console.error("[presence/heartbeat]", error.message);
      return NextResponse.json({ error: "Couldn't record heartbeat." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[presence/heartbeat] unexpected", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
