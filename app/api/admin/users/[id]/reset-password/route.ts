import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole, logAdminAction, isUuid } from "@/lib/admin-auth";
import { assertTrustedOrigin, UntrustedOriginError } from "@/lib/team/origin-check";
import { sendResetEmail } from "@/lib/emails/reset-password";
import { absoluteUrl } from "@/lib/site-config";

/**
 * POST /api/admin/users/[id]/reset-password — send a password-reset email.
 * Support and admin. The most common customer-support action.
 *
 * The server looks up the email itself, so support staff can trigger a reset
 * without ever seeing the raw address. Logs `password_reset` to
 * admin_audit_log.
 *
 * Delivery: mints a ONE-TIME recovery link via
 * supabaseAdmin.auth.admin.generateLink({ type: "recovery" }) and sends it over
 * Resend — deliberately NOT Supabase's built-in/custom SMTP. This is the same
 * proven path the team-reset route uses, and it means this support action never
 * depends on the dashboard SMTP credential (whose silent expiry broke every
 * Supabase-rendered auth email on 2026-07-08). The recovery link is
 * bearer-equivalent: it is NEVER logged, and never written to the audit trail.
 *
 * Env-gated at CALL time (never at module load): RESEND_API_KEY, EMAIL_FROM.
 */

type RouteCtx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const staff = await requireRole(req, "support");
  if (staff instanceof NextResponse) return staff;

  // Defense in depth: parity with the team-reset route — these credential
  // routes reject cross-origin callers even though auth is Bearer-based.
  try {
    assertTrustedOrigin(req);
  } catch (err) {
    if (err instanceof UntrustedOriginError) {
      return NextResponse.json({ error: "Forbidden" }, { status: err.status });
    }
    throw err;
  }

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  // Env gate (read at call time so a missing var is a clear error, not a
  // module-load crash). 503 = server misconfigured, distinct from a send fail.
  const resendKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM;
  if (!resendKey) {
    return NextResponse.json(
      { error: "Email not configured: set RESEND_API_KEY" },
      { status: 503 },
    );
  }
  if (!emailFrom) {
    return NextResponse.json(
      { error: "Email not configured: set EMAIL_FROM" },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(params.id);
  if (error || !data?.user?.email) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const email = data.user.email;
  // Best-effort display name for the greeting; falls back to "there".
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    typeof meta.full_name === "string"
      ? meta.full_name
      : typeof meta.name === "string"
        ? meta.name
        : null;

  // Mint the one-time recovery link. /reset-password hosts the new-password
  // form; the link signs the user in via detectSessionInUrl and the page calls
  // auth.updateUser. (redirectTo must be on the Supabase Auth Redirect-URL
  // allowlist for the link to land on our form.)
  const { data: linkData, error: linkErr } =
    await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: absoluteUrl("/reset-password") },
    });
  if (linkErr || !linkData?.properties?.action_link) {
    console.error(
      "[admin/reset-password] generateLink failed:",
      linkErr?.message ?? "no action_link returned",
    );
    return NextResponse.json(
      { error: "Reset link could not be created" },
      { status: 500 },
    );
  }
  const resetUrl = linkData.properties.action_link;

  // Deliver via Resend (shared helper — same path the team route uses). The
  // link is the single sensitive value and is never logged. Email is the only
  // delivery channel here (unlike the team route, we never reveal the link to
  // the caller), so a send failure is a hard 502.
  const sent = await sendResetEmail({
    resendKey,
    emailFrom,
    to: email,
    fullName,
    resetUrl,
    logTag: "admin/reset-password",
  });
  if (!sent) {
    return NextResponse.json(
      { error: "Email provider rejected the reset email. Check email config." },
      { status: 502 },
    );
  }

  await logAdminAction({
    performedBy: staff.userId,
    action: "password_reset",
    targetUserId: params.id,
  });

  return NextResponse.json({ ok: true });
}
