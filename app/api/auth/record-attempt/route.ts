import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

/**
 * Records one login attempt (success or failure) into `login_attempts` so
 * /api/auth/check-lock can later decide whether to rate-limit an email.
 *
 * ALWAYS fails open with HTTP 200 when the table is missing or the DB
 * errors — this is a defense-in-depth feature and must never block a
 * legitimate login. The returned `{ ok: false }` is informational only.
 */

const PG_UNDEFINED_TABLE = "42P01";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email   = (body.email   ?? "").trim().toLowerCase();
  const success = Boolean(body.success);

  if (!email) {
    return NextResponse.json({ ok: false, reason: "missing email" });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;

  try {
    const { error } = await supabaseAdmin.from("login_attempts").insert({
      email,
      ip_address: ip,
      success,
      attempted_at: new Date().toISOString(),
    });

    if (error) {
      if (error.code !== PG_UNDEFINED_TABLE) {
        console.error("[record-attempt] DB error:", error.message);
      }
      return NextResponse.json({ ok: false, reason: "table_missing_or_error" });
    }

    // 5-failure security-alert email (best-effort, never blocking)
    if (!success) {
      const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count, error: countErr } = await supabaseAdmin
        .from("login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("email", email)
        .eq("success", false)
        .gte("attempted_at", windowStart);

      if (!countErr && (count ?? 0) >= 5) {
        await supabaseAdmin.auth.admin
          .generateLink({ type: "recovery", email })
          .catch(() => null);
      }
    }

    // Clear recent failed attempts on successful login
    if (success) {
      await supabaseAdmin
        .from("login_attempts")
        .delete()
        .eq("email", email)
        .eq("success", false)
        .then(() => {}, () => {}); // best-effort
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (!msg.includes("does not exist")) {
      console.error("[record-attempt] exception:", msg);
    }
    // Fail open — login must not be blocked by our ability to log attempts.
    return NextResponse.json({ ok: false, reason: "exception" });
  }
}
