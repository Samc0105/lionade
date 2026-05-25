/**
 * Supabase Auth webhook — fires once per email-verify completion.
 *
 * Wires the Phase 1 `welcome` email template that was deferred at Phase 1
 * shipping because no /api/auth/callback route existed. Supabase Auth Hooks
 * fire SERVER-TO-SERVER, post-verify, with the verified user payload — which
 * is more reliable than a post-verify client fetch (no risk of the user
 * closing the tab between verify and welcome).
 *
 * --- Setup (one-time, Sam pastes) ----------------------------------------
 * 1. Set env var `SUPABASE_AUTH_HOOK_SECRET` on Vercel (any long random string;
 *    `openssl rand -base64 48` works). DO NOT commit the value.
 * 2. Supabase dashboard → Project Settings → Authentication → Auth Hooks
 *    (or "Webhooks"). Add an HTTP hook for the `email-verified` event.
 *    URL:      https://getlionade.com/api/auth/welcome
 *    Method:   POST
 *    Headers:  Authorization: Bearer <SAME value as SUPABASE_AUTH_HOOK_SECRET>
 *
 * The route REJECTS any request missing or mismatching that bearer. Without
 * the secret pasted, all webhook payloads 401 — failure-closed by design.
 *
 * --- Replay safety -------------------------------------------------------
 * Idempotent at TWO layers:
 *   1. Supabase fires the hook once per verify. (External contract.)
 *   2. `profiles.welcome_email_sent_at` is the local gate. If non-null on
 *      arrival, we 204 No Content WITHOUT calling Resend. Even if Supabase
 *      retries on transient failure, no duplicate send. Stamp written ONLY
 *      after Resend confirms success — failure leaves the column NULL so
 *      the next retry succeeds.
 *
 * --- Security (see comments below) ---------------------------------------
 *   - Bearer must match SUPABASE_AUTH_HOOK_SECRET (constant-time compare).
 *   - Recipient email is resolved by `supabaseAdmin.auth.admin.getUserById`
 *     using the userId FROM THE PAYLOAD. We do NOT trust any address field
 *     the payload may include — that would be the spoofing surface.
 *     (Even though Supabase signs the request with the bearer secret, we
 *     don't rely on payload email — server-side lookup is the canonical
 *     source.)
 *   - No path traversal / SQL injection / XSS surface — payload userId is
 *     passed to parameterized .eq() calls only; no HTML interpolation of
 *     user input into the email body.
 *   - Rate-limited via the `/api/` catch-all in middleware.ts (100/min/IP).
 *     Supabase webhooks come from their hosted infra, well below that cap.
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { renderEmail, templates } from "@/lib/emails";
import { absoluteUrl } from "@/lib/site-config";

// Constant-time string compare — avoids timing oracles when an attacker
// brute-forces the secret. Length difference is leaked (and unavoidable
// without padding), but the per-character compare is fixed-time-ish.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized(reason: string): NextResponse {
  // Log enough to debug a misconfigured webhook without leaking the secret.
  console.warn("[auth/welcome] rejected:", reason);
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  // --- 1. Authenticate the webhook caller -------------------------------
  const expected = process.env.SUPABASE_AUTH_HOOK_SECRET;
  if (!expected) {
    // Failure-closed: if the secret isn't configured, we cannot trust
    // ANY incoming payload. Reject everything until Sam pastes it.
    return unauthorized("SUPABASE_AUTH_HOOK_SECRET not configured");
  }
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return unauthorized("missing or malformed Authorization header");
  }
  const presented = header.slice(7).trim();
  if (!presented || !safeEqual(presented, expected)) {
    return unauthorized("hook secret mismatch");
  }

  // --- 2. Parse the payload --------------------------------------------
  // Supabase's email-verified hook payload includes `record.id` (the
  // auth.users row id). We accept a couple of shapes defensively because
  // the exact shape varies between "Auth Hooks" and legacy "Database
  // Webhooks". The userId is the ONLY field we read — everything else
  // (email, name, etc.) we look up server-side.
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = extractUserId(payload);
  if (!userId) {
    // 200 not 400 — Supabase will retry on non-2xx, and there's nothing
    // a retry can fix. Log + acknowledge.
    console.warn("[auth/welcome] payload missing user id:", JSON.stringify(payload).slice(0, 300));
    return NextResponse.json({ ok: true, skipped: "no-user-id" });
  }

  // --- 3. Idempotency check --------------------------------------------
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("welcome_email_sent_at, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr) {
    // Profile row not yet created (handle_new_user trigger races webhook?)
    // Acknowledge so Supabase doesn't retry-storm us — but flag for review.
    console.warn("[auth/welcome] profile lookup failed:", profileErr.message);
    return NextResponse.json({ ok: true, skipped: "profile-not-found" });
  }

  if (profile?.welcome_email_sent_at) {
    // Replay: already sent. 204 No Content, NO retry needed.
    return new NextResponse(null, { status: 204 });
  }

  // --- 4. Resolve recipient email (server-side, NEVER from payload) -----
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.warn("[auth/welcome] RESEND_API_KEY or EMAIL_FROM missing — cannot send");
    // Acknowledge so the hook doesn't retry forever on a config gap.
    return NextResponse.json({ ok: true, skipped: "email-not-configured" });
  }

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const toEmail = authUser?.user?.email;
  if (!toEmail) {
    console.warn("[auth/welcome] no email for user:", userId);
    return NextResponse.json({ ok: true, skipped: "no-email" });
  }

  // --- 5. Render + send -------------------------------------------------
  const rendered = renderEmail(templates.welcome, {
    userName: (profile?.display_name as string | null) || undefined,
    ctaUrl: absoluteUrl("/dashboard"),
    ctaLabel: "Open dashboard",
  });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: emailErr } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: toEmail,
      replyTo: "support@getlionade.com",
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (emailErr) {
      console.warn("[auth/welcome] Resend failed:", JSON.stringify(emailErr));
      // Don't stamp on failure — next retry should send. Return 500 so
      // Supabase retries with backoff. (Acceptable retry surface; the
      // idempotency gate above protects against duplicate sends.)
      return NextResponse.json({ error: "Email send failed" }, { status: 500 });
    }
  } catch (sendErr) {
    console.warn("[auth/welcome] Resend exception:", sendErr);
    return NextResponse.json({ error: "Email send failed" }, { status: 500 });
  }

  // --- 6. Stamp the send (replay defense) -------------------------------
  const stamp = new Date().toISOString();
  const { error: stampErr } = await supabaseAdmin
    .from("profiles")
    .update({ welcome_email_sent_at: stamp })
    .eq("id", userId)
    .is("welcome_email_sent_at", null); // belt-and-braces — don't overwrite

  if (stampErr) {
    // Email already sent successfully — losing the stamp risks a duplicate
    // on retry, but Supabase doesn't retry 2xx. Log for ops visibility.
    console.warn("[auth/welcome] stamp write failed (email sent OK):", stampErr.message);
  }

  return NextResponse.json({ ok: true, sent: true });
}

/**
 * Pulls the verified user id out of any reasonable Supabase webhook shape.
 * Returns null if absent. We do NOT accept query params or anything outside
 * the POST body — the only attacker-controlled surface is the body, and
 * since we've already gated on the bearer secret above, body trust is OK
 * for "which user" lookup (but NOT for email address — that's resolved
 * server-side via admin.getUserById in step 4).
 */
function extractUserId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  // Auth Hooks (new): { user: { id: "..." }, ... }
  const user = obj.user as Record<string, unknown> | undefined;
  if (user && typeof user.id === "string") return user.id;
  // Database Webhooks (legacy): { record: { id: "..." }, type: "INSERT", ... }
  const record = obj.record as Record<string, unknown> | undefined;
  if (record && typeof record.id === "string") return record.id;
  // Some hooks send flat { user_id: "..." }
  if (typeof obj.user_id === "string") return obj.user_id;
  if (typeof obj.id === "string") return obj.id;
  return null;
}
