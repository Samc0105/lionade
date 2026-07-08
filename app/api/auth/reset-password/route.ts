import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sendResetEmail } from "@/lib/emails/reset-password";
import { absoluteUrl } from "@/lib/site-config";

/**
 * POST /api/auth/reset-password — PUBLIC self-serve password-reset request.
 *
 * Mints a one-time recovery link via generateLink({ type: "recovery" }) and
 * delivers it over Resend — the SAME path the admin reset uses, deliberately
 * NOT Supabase's built-in/custom SMTP (whose silent credential expiry on
 * 2026-07-08 broke every Supabase-rendered auth email, including the old
 * client-side resetPasswordForEmail this route replaces).
 *
 * SECURITY:
 *   - No enumeration: every account-SPECIFIC outcome (address exists + sent,
 *     address exists + send failed, address unknown) returns an identical
 *     `{ ok: true }`. Only account-INDEPENDENT conditions get a distinct status
 *     — 400 (malformed email), 503 (email not configured). Rate limiting is
 *     enforced upstream in middleware.ts (auth-reset: 5 / 15min / IP), whose
 *     429 is also account-independent. The Resend send runs in waitUntil (not
 *     awaited), so a real address and an unknown one return at the same speed —
 *     no timing oracle from the outbound send round-trip.
 *   - The recovery link is bearer-equivalent and is NEVER logged.
 *   - No auth: this is the front-half of account recovery, reachable signed-out.
 *
 * Env-gated at CALL time: RESEND_API_KEY, EMAIL_FROM.
 */

// Deliberately loose — real validation is "can Supabase mint a link for it".
// This only rejects obviously-malformed input so we don't churn on garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const email =
    body && typeof body === "object" && typeof (body as { email?: unknown }).email === "string"
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }

  // Env gate (account-independent — safe to distinguish; same for every email).
  const resendKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM;
  if (!resendKey || !emailFrom) {
    console.error("[auth/reset-password] email not configured (RESEND_API_KEY/EMAIL_FROM)");
    return NextResponse.json(
      { error: "Password reset is temporarily unavailable. Try again shortly." },
      { status: 503 },
    );
  }

  // Everything below is account-SPECIFIC and MUST resolve to the same response
  // regardless of whether the address has an account — otherwise the timing /
  // status becomes an enumeration oracle. We send only on a real link; any
  // other outcome (unknown email, mint error, send failure) is swallowed to a
  // 200 and logged server-side without the address.
  try {
    const { data: linkData, error: linkErr } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: absoluteUrl("/reset-password") },
      });
    if (!linkErr && linkData?.properties?.action_link) {
      // Send in waitUntil (NOT awaited): the outbound Resend round-trip happens
      // after the response, so a real address returns as fast as an unknown one
      // (closes the send-latency timing oracle). Its boolean is dropped for the
      // same reason — a provider hiccup must not change the response.
      waitUntil(
        sendResetEmail({
          resendKey,
          emailFrom,
          to: email,
          fullName: null,
          resetUrl: linkData.properties.action_link,
          logTag: "auth/reset-password",
        }),
      );
    } else if (linkErr) {
      // Almost always "user not found" — expected and NOT surfaced.
      console.warn("[auth/reset-password] no recovery link minted (likely unknown email)");
    }
  } catch (err) {
    console.error(
      "[auth/reset-password] unexpected error:",
      err instanceof Error ? err.message : "unknown",
    );
    // Still return ok — never leak that this particular address errored.
  }

  return NextResponse.json({ ok: true });
}
