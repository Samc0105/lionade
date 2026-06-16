// POST /api/admin/team/provision — atomic team-member onboarding. ADMIN ONLY.
//
// This is the single most privileged route in the product: one call mints a
// real @getlionade.com forwarding mailbox (Cloudflare), optionally a real
// Lionade Supabase account with a temporary credential, persists the
// team_members row, generates a one-time password-reset link, and emails the
// new colleague their login. It MUST be atomic — there is no acceptable
// half-provisioned state (a Cloudflare rule with no DB row, or a Supabase user
// with no mailbox), so every side effect after the first is wrapped in a
// rollback stack that unwinds in reverse on any later failure.
//
// SECURITY INVARIANTS (non-negotiable):
//   - requireRole(req, "admin") gates the route (service-role work below).
//   - assertTrustedOrigin + assertProvisionRateLimit run before any side effect.
//   - The temporary password is delivered ONLY via the welcome email body
//     (that is the channel by design). It is NEVER logged, NEVER written to
//     admin_audit_log.metadata (writeTeamAudit also strips it as defense in
//     depth), and NEVER returned in the API response. The returned row carries
//     no secrets.
//   - Every env var is read at CALL time by the helpers we delegate to
//     (getEmailProvider, Resend getter) — a missing env surfaces as a clear
//     "not configured: set X" error, never a module-load crash.

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";
import { SITE_URL } from "@/lib/site-config";
import {
  getEmailProvider,
  isEmailProviderConfigured,
} from "@/lib/team/email-provider";
import { generateTempPassword } from "@/lib/team/password";
import { writeTeamAudit } from "@/lib/team/audit";
import { assertProvisionRateLimit, RateLimitError } from "@/lib/team/rate-limit";
import { assertTrustedOrigin, UntrustedOriginError } from "@/lib/team/origin-check";
import { renderTeamWelcomeEmail } from "@/lib/emails/team-welcome";
import type {
  LionadeAccess,
  TeamMember,
  TeamRole,
} from "@/lib/team/types";

/** Resend timeout for outbound mail — 15s, matching the lib convention. */
const RESEND_TIMEOUT_MS = 15_000;

const VALID_ROLES: readonly TeamRole[] = [
  "founder",
  "engineer",
  "support",
  "contractor",
  "advisor",
  "former_team",
];

const VALID_ACCESS: readonly LionadeAccess[] = ["none", "viewer", "editor", "admin"];

// Mirrors the DB CHECK on team_members.username: ^[a-z][a-z0-9.-]{2,30}$.
const USERNAME_RE = /^[a-z][a-z0-9.-]{2,30}$/;

// Conservative email shape check, matching the other Lionade routes. We are
// validating a human-supplied personal/forwarding address, not parsing RFC 5322.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ProvisionBody {
  full_name?: unknown;
  username?: unknown;
  personal_email?: unknown;
  role?: unknown;
  lionade_access?: unknown;
}

/** A single undo step in the rollback stack. Best-effort; never throws. */
type RollbackStep = () => Promise<void>;

export async function POST(req: NextRequest) {
  // 1) AuthZ — admin only. Returns a ready 401/403 NextResponse on failure.
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  // 2) Defense-in-depth origin check (see lib/team/origin-check.ts).
  try {
    assertTrustedOrigin(req);
  } catch (e) {
    if (e instanceof UntrustedOriginError) {
      return NextResponse.json({ error: "Forbidden" }, { status: e.status });
    }
    throw e;
  }

  // 3) Rate limit BEFORE any side effect — fails closed on a count error.
  try {
    await assertProvisionRateLimit(supabaseAdmin, staff.userId);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status, headers: { "Retry-After": String(e.retryAfterSeconds) } },
      );
    }
    throw e;
  }

  // 4) Parse + validate the request body. Specific 400s, no side effects yet.
  let body: ProvisionBody;
  try {
    body = (await req.json()) as ProvisionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const username =
    typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const personalEmail =
    typeof body.personal_email === "string" ? body.personal_email.trim() : "";
  const role = body.role as TeamRole;
  const lionadeAccess = body.lionade_access as LionadeAccess;

  if (fullName.length < 1 || fullName.length > 120) {
    return NextResponse.json(
      { error: "full_name is required (1-120 characters)" },
      { status: 400 },
    );
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      {
        error:
          "username must match ^[a-z][a-z0-9.-]{2,30}$ (lowercase, starts with a letter)",
      },
      { status: 400 },
    );
  }
  if (!EMAIL_RE.test(personalEmail) || personalEmail.length > 254) {
    return NextResponse.json(
      { error: "personal_email must be a valid email address" },
      { status: 400 },
    );
  }
  if (typeof body.role !== "string" || !VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `role must be one of: ${VALID_ROLES.join(", ")}` },
      { status: 400 },
    );
  }
  if (typeof body.lionade_access !== "string" || !VALID_ACCESS.includes(lionadeAccess)) {
    return NextResponse.json(
      { error: `lionade_access must be one of: ${VALID_ACCESS.join(", ")}` },
      { status: 400 },
    );
  }

  // 5) Env preflight — fail fast with an actionable message BEFORE we start
  //    creating anything, so we never get stuck mid-provision because email
  //    sending was never configured.
  if (!isEmailProviderConfigured()) {
    return NextResponse.json(
      {
        error:
          "Email provider not configured: set CLOUDFLARE_API_TOKEN/CLOUDFLARE_ZONE_ID/CLOUDFLARE_EMAIL_ROUTING_DOMAIN",
      },
      { status: 503 },
    );
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return NextResponse.json(
      { error: "Email sending not configured: set RESEND_API_KEY and EMAIL_FROM" },
      { status: 503 },
    );
  }

  const emailDomain = (process.env.CLOUDFLARE_EMAIL_ROUTING_DOMAIN || "getlionade.com").trim();
  const teamEmail = `${username}@${emailDomain}`;
  const lionadeAccessGranted = lionadeAccess !== "none";

  // 6) Duplicate guards (read-only). The DB has UNIQUE constraints on username
  //    and email_address as the real backstop; we pre-check for a clean 409
  //    instead of a generic constraint-violation 500.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("team_members")
    .select("id")
    .or(`username.eq.${username},email_address.eq.${teamEmail}`)
    .limit(1);
  if (existingError) {
    console.error("[team/provision] duplicate-check failed:", existingError.message);
    return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
  }
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: "A team member with that username already exists" },
      { status: 409 },
    );
  }

  // Make sure the mailbox isn't already routed in Cloudflare (e.g. created by
  // hand, or left behind by a prior failed run). A free address is required
  // before we create the route.
  const provider = getEmailProvider();
  try {
    const addresses = await provider.listAddresses();
    const clash = addresses.some(
      (a) => a.address.trim().toLowerCase() === teamEmail.toLowerCase(),
    );
    if (clash) {
      return NextResponse.json(
        { error: "That mailbox already exists at the email provider" },
        { status: 409 },
      );
    }
  } catch (e) {
    // Could be a missing-env or a Cloudflare API error. The provider messages
    // are safe (never contain the token) — surface a clear, non-leaking error.
    const msg = e instanceof Error ? e.message : "Email provider check failed";
    console.error("[team/provision] provider preflight failed:", msg);
    return NextResponse.json(
      { error: "Could not verify the mailbox with the email provider" },
      { status: 502 },
    );
  }

  // ── Side-effect zone: every step below pushes an undo onto `rollback`. ────
  const rollback: RollbackStep[] = [];
  /** Run the rollback stack in reverse. Best-effort; logs but never throws. */
  async function unwind(): Promise<void> {
    for (let i = rollback.length - 1; i >= 0; i--) {
      try {
        await rollback[i]();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "rollback step failed";
        console.error("[team/provision] rollback step failed:", msg);
      }
    }
  }

  // 7) Create the Cloudflare forwarding route (first persistent side effect).
  let cloudflareAddressId: string;
  try {
    const created = await provider.createAddress(username, personalEmail);
    cloudflareAddressId = created.addressId;
    rollback.push(async () => {
      await provider.deleteAddress(cloudflareAddressId);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "createAddress failed";
    console.error("[team/provision] cloudflare createAddress failed:", msg);
    return NextResponse.json(
      { error: "Could not create the team mailbox" },
      { status: 502 },
    );
  }

  // 8) Mint a temporary password. CSPRNG; never logged/returned/audited.
  const tempPassword = generateTempPassword();

  // 9) Optionally create the real Supabase auth account.
  let authUserId: string | null = null;
  if (lionadeAccessGranted) {
    const { data: created, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email: personalEmail,
        email_confirm: true,
        password: tempPassword,
        user_metadata: {
          must_change_password: true,
          role,
          full_name: fullName,
        },
      });
    if (createError || !created?.user) {
      // Never echo createError.message — it can reflect attacker-tunable input
      // (e.g. "email already registered"). Log it server-side only.
      console.error(
        "[team/provision] auth createUser failed:",
        createError?.message ?? "no user returned",
      );
      await unwind();
      const alreadyExists =
        createError?.message?.toLowerCase().includes("already") ?? false;
      return NextResponse.json(
        {
          error: alreadyExists
            ? "A Lionade account already exists for that personal email"
            : "Could not create the Lionade account",
        },
        { status: alreadyExists ? 409 : 502 },
      );
    }
    authUserId = created.user.id;
    rollback.push(async () => {
      await supabaseAdmin.auth.admin.deleteUser(authUserId as string);
    });
  }

  // 10) Insert the team_members row.
  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("team_members")
    .insert({
      user_id: authUserId,
      full_name: fullName,
      username,
      email_address: teamEmail,
      personal_email: personalEmail,
      cloudflare_address_id: cloudflareAddressId,
      role,
      lionade_access: lionadeAccess,
      status: "pending",
      must_change_password: lionadeAccessGranted,
      invited_by: staff.userId,
      invited_at: nowIso,
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    console.error(
      "[team/provision] team_members insert failed:",
      insertError?.message ?? "no row returned",
    );
    await unwind();
    return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
  }
  // The inserted row maps straight onto TeamMember (select("*") + snake_case).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js
  // generic Database type isn't generated in this project (see lib/team/audit.ts);
  // the default client returns an untyped row. This single assertion is the
  // unavoidable Supabase-type gap.
  const teamMember = inserted as unknown as TeamMember;
  rollback.push(async () => {
    await supabaseAdmin.from("team_members").delete().eq("id", teamMember.id);
  });

  // 11) Generate the one-time recovery link (only when access was granted —
  //     a forwarding-only member never logs in).
  let passwordResetUrl: string | null = null;
  if (lionadeAccessGranted) {
    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: personalEmail,
        options: { redirectTo: `${SITE_URL}/reset-password` },
      });
    if (linkError || !linkData?.properties?.action_link) {
      console.error(
        "[team/provision] generateLink failed:",
        linkError?.message ?? "no action_link returned",
      );
      await unwind();
      return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
    }
    passwordResetUrl = linkData.properties.action_link;
  }

  // 12) Render + send the welcome email. The temp password + reset link live
  //     ONLY in this email body (the delivery channel by design).
  let rendered: { subject: string; html: string; text: string };
  try {
    rendered = renderTeamWelcomeEmail({
      fullName,
      username,
      emailDomain,
      lionadeAccessGranted,
      temporaryPassword: lionadeAccessGranted ? tempPassword : null,
      passwordResetUrl,
    });
  } catch (e) {
    // renderTeamWelcomeEmail throws if a required credential slot is missing —
    // that would be a logic bug here, but treat it as a hard failure + rollback.
    const msg = e instanceof Error ? e.message : "email render failed";
    console.error("[team/provision] welcome render failed:", msg);
    await unwind();
    return NextResponse.json({ error: "Provisioning failed" }, { status: 500 });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    // The Resend SDK manages its own fetch and does not expose an AbortSignal,
    // so we enforce the 15s outbound-call budget with a Promise.race timeout
    // (per the lib timeout convention) rather than an unsupported send option.
    const sendPromise = resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: personalEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Resend send timed out after ${RESEND_TIMEOUT_MS}ms`)),
        RESEND_TIMEOUT_MS,
      );
    });
    const { error: sendError } = await Promise.race([sendPromise, timeoutPromise]);
    if (sendError) {
      // Resend SDK returns { error } rather than throwing for API errors.
      throw new Error(sendError.message);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "email send failed";
    console.error("[team/provision] welcome send failed:", msg);
    await unwind();
    return NextResponse.json(
      { error: "Could not send the welcome email" },
      { status: 502 },
    );
  }

  // 13) Provisioning succeeded — commit. Clear the rollback stack so a later
  //     audit hiccup can never trigger an unwind of completed work.
  rollback.length = 0;

  // 14) Audit AFTER success. NEVER include the password (writeTeamAudit also
  //     strips credential-like keys as a last-line guard). performed_by is the
  //     admin; target_user_id is the new auth user (null for forwarding-only).
  const audit = await writeTeamAudit(supabaseAdmin, {
    performedBy: staff.userId,
    action: "team_provision",
    targetUserId: authUserId,
    metadata: {
      team_member_id: teamMember.id,
      username,
      email_address: teamEmail,
      role,
      lionade_access: lionadeAccess,
      lionade_access_granted: lionadeAccessGranted,
      cloudflare_address_id: cloudflareAddressId,
      auth_user_created: authUserId !== null,
    },
  });

  // 15) Return the team_member row — no secrets, ever.
  return NextResponse.json(
    {
      ok: true,
      teamMember,
      ...(audit.ok ? {} : { audit_log_failed: true }),
    },
    { status: 201 },
  );
}
