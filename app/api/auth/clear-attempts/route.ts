// Authed counterpart to /api/auth/record-attempt — clears the failed-attempt
// counter for the authenticated user's own email after a successful login.
//
// Why this exists: the public record-attempt endpoint must reject success:true
// (otherwise any attacker could clear an arbitrary email's counter and bypass
// lockout). The legitimate post-login clear path goes here, gated on a valid
// session JWT, so a caller can only clear their OWN email.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

const PG_UNDEFINED_TABLE = "42P01";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const email = (auth.email ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: false });

  try {
    const { error } = await supabaseAdmin
      .from("login_attempts")
      .delete()
      .eq("email", email)
      .eq("success", false);

    if (error && error.code !== PG_UNDEFINED_TABLE) {
      console.error("[clear-attempts] DB error:", error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (!msg.includes("does not exist")) {
      console.error("[clear-attempts] exception:", msg);
    }
    // Fail open — not being able to clear the counter must not break login.
    return NextResponse.json({ ok: false });
  }
}
