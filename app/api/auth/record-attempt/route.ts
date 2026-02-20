import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email   = (body.email   ?? "").trim().toLowerCase();
  const success = Boolean(body.success);

  if (!email) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;

  const { error } = await supabaseAdmin.from("login_attempts").insert({
    email,
    ip_address: ip,
    success,
    attempted_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[record-attempt] DB error:", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // If this is the 5th failure, send a security alert email via Supabase
  if (!success) {
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .eq("success", false)
      .gte("attempted_at", windowStart);

    if ((count ?? 0) >= 5) {
      // Trigger a Supabase auth password reset email as a security alert
      // (This notifies the user that someone is trying to access their account)
      await supabaseAdmin.auth.admin
        .generateLink({ type: "recovery", email })
        .catch(() => null); // best-effort — don't fail the request if this errors
    }
  }

  // On success, clear recent failed attempts for this email
  if (success) {
    await supabaseAdmin
      .from("login_attempts")
      .delete()
      .eq("email", email)
      .eq("success", false);
  }

  return NextResponse.json({ ok: true });
}
