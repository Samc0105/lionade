// GET /api/cron/academia-digest — Vercel cron entry point.
//
// Fires once a week (Monday ~8am ET = 13:00 UTC) per the schedule in
// `vercel.json`. Sends each opted-in user a digest of their dated Academia
// items over the next 7 days (exam target dates + assignment due dates,
// grouped by day, annotated with class name).
//
// --- Auth (copied verbatim from reap-afk-presence) -----------------------
// Vercel sends the cron secret as `Authorization: Bearer $CRON_SECRET`.
// HEADER-ONLY (no query-string fallback — secrets must never land in logs).
// Constant-time compare via node:crypto timingSafeEqual. 500 if the secret
// is unset (failure-closed), 401 on mismatch.
//
// --- Eligibility ----------------------------------------------------------
// We send to a user when `profiles.preferences.notifications.weekly_report`
// is true OR absent. The system default for weekly_report is `true`
// (DEFAULT_NOTIFICATION_PREFS in lib/db.ts), and that's the value the user
// sees in their settings UI before they ever touch the toggle. So "missing"
// must mean "on" to match what the user believes is true. We skip ONLY when
// the toggle is explicitly `false`. Users with zero dated items in the
// 7-day window are skipped too (no empty digests).
//
// --- Recipient email ------------------------------------------------------
// Resolved server-side via supabaseAdmin.auth.admin.getUserById(userId),
// the same canonical source app/api/auth/welcome uses. We never trust a
// stored/email-shaped column for the send target.
//
// --- Idempotency ----------------------------------------------------------
// V1 choice: NO dedupe table. A weekly cron fires once; Vercel does not
// retry cron invocations the way an auth webhook retries. A double-send
// would require a manual double-trigger, which is an acceptable V1 risk for
// a low-frequency informational email. If we later see duplicates, the
// lightweight guard is a `profiles.academia_digest_sent_at` timestamp gated
// with `.lt("academia_digest_sent_at", weekStart)` (documented here, not
// built, to avoid a migration this round).
//
// --- Run bounds -----------------------------------------------------------
// Capped at MAX_USERS_PER_RUN candidates per invocation to bound runtime /
// Resend volume. Counts (sent / skipped / failed) are logged + returned.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { renderEmail, templates, BRAND } from "@/lib/emails";
import { absoluteUrl } from "@/lib/site-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cap candidates per run. The current user base is small; this is a safety
// bound, not a paging cursor. If the base grows past this we add a cursor.
const MAX_USERS_PER_RUN = 500;
const WINDOW_DAYS = 7;

// ─── Date helpers (UTC math, mirrors academia/agenda) ─────────────────────
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "Jun 10" style label for a YYYY-MM-DD (UTC, locale-stable).
function shortLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// "Tuesday, Jun 10" style day header.
function dayHeader(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// HTML escape (mirrors app/api/contact/route.ts). Class + item titles are
// user-authored, so they MUST be escaped before landing in the email body.
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface DigestItem {
  kind: "exam" | "assignment";
  date: string; // YYYY-MM-DD
  title: string;
  className: string;
}

// ─── Per-user agenda (next 7 days), reusing academia/agenda query shape ───
async function loadAgenda(userId: string, from: string, to: string): Promise<DigestItem[]> {
  const [examsRes, assignmentsRes] = await Promise.all([
    supabaseAdmin
      .from("user_exams")
      .select("id, class_id, title, target_date")
      .eq("user_id", userId)
      .eq("archived", false)
      .not("target_date", "is", null)
      .gte("target_date", from)
      .lte("target_date", to),
    supabaseAdmin
      .from("class_assignments")
      .select("id, class_id, title, due_date")
      .eq("user_id", userId)
      .not("due_date", "is", null)
      .gte("due_date", from)
      .lte("due_date", to),
  ]);

  if (examsRes.error) throw examsRes.error;
  if (assignmentsRes.error) throw assignmentsRes.error;

  const exams = examsRes.data ?? [];
  const assignments = assignmentsRes.data ?? [];

  // Resolve class names for every referenced class (user-scoped).
  const classIds = Array.from(
    new Set(
      [...exams, ...assignments]
        .map((r) => r.class_id)
        .filter((id): id is string => !!id),
    ),
  );

  const classNameById = new Map<string, string>();
  if (classIds.length) {
    const { data: classes, error: clsErr } = await supabaseAdmin
      .from("classes")
      .select("id, name")
      .in("id", classIds)
      .eq("user_id", userId);
    if (clsErr) throw clsErr;
    for (const c of classes ?? []) classNameById.set(c.id, c.name);
  }

  const items: DigestItem[] = [];

  for (const e of exams) {
    if (!e.target_date) continue;
    // Class-less Mastery exam targets still belong on the calendar.
    let className = "Mastery";
    if (e.class_id) {
      const name = classNameById.get(e.class_id);
      if (!name) continue; // class missing / owned by someone else: skip
      className = name;
    }
    items.push({ kind: "exam", date: e.target_date, title: e.title, className });
  }

  for (const a of assignments) {
    if (!a.class_id || !a.due_date) continue;
    const name = classNameById.get(a.class_id);
    if (!name) continue;
    items.push({ kind: "assignment", date: a.due_date, title: a.title, className: name });
  }

  items.sort((x, y) => {
    if (x.date !== y.date) return x.date < y.date ? -1 : 1;
    if (x.kind !== y.kind) return x.kind === "exam" ? -1 : 1;
    return 0;
  });

  return items;
}

// ─── Render the day-grouped agenda into HTML + text ───────────────────────
function buildAgendaHtml(items: DigestItem[]): { html: string; text: string } {
  const byDay = new Map<string, DigestItem[]>();
  for (const it of items) {
    const arr = byDay.get(it.date) ?? [];
    arr.push(it);
    byDay.set(it.date, arr);
  }

  const days = Array.from(byDay.keys()).sort();

  const htmlBlocks: string[] = [];
  const textLines: string[] = [];

  for (const day of days) {
    const dayItems = byDay.get(day) ?? [];
    const header = escapeHtml(dayHeader(day));

    const rows = dayItems
      .map((it) => {
        const tag = it.kind === "exam" ? "Exam" : "Due";
        const title = escapeHtml(it.title);
        const cls = escapeHtml(it.className);
        return `<tr>
  <td style="padding:10px 14px;background:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:8px;font-size:15px;line-height:1.5;color:${BRAND.ink};">
    <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.goldDark};margin-right:8px;">${tag}</span>
    <strong>${title}</strong>
    <span style="color:${BRAND.muted};font-size:13px;"> &middot; ${cls}</span>
  </td>
</tr>
<tr><td style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
      })
      .join("\n");

    htmlBlocks.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 14px 0;">
  <tr>
    <td style="font-size:14px;font-weight:700;color:${BRAND.ink};padding:0 0 8px 2px;">${header}</td>
  </tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px 0;">
${rows}
</table>`);

    textLines.push(dayHeader(day));
    for (const it of dayItems) {
      const tag = it.kind === "exam" ? "Exam" : "Due";
      textLines.push(`  - ${tag}: ${it.title} (${it.className})`);
    }
    textLines.push("");
  }

  return { html: htmlBlocks.join("\n"), text: textLines.join("\n").trim() };
}

export async function GET(req: NextRequest) {
  // --- 1. Auth (copied from reap-afk-presence) --------------------------
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/academia-digest] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const aBuf = Buffer.from(authHeader);
  const eBuf = Buffer.from(expected);
  if (aBuf.length !== eBuf.length || !timingSafeEqual(aBuf, eBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- 2. Email config gate --------------------------------------------
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.error("[cron/academia-digest] RESEND_API_KEY or EMAIL_FROM missing");
    return NextResponse.json({ error: "Email not configured" }, { status: 500 });
  }

  const from = todayUtc();
  const to = addDays(from, WINDOW_DAYS);
  const weekRangeLabel = `${shortLabel(from)} to ${shortLabel(to)}`;
  const prefsUrl = absoluteUrl("/settings");
  const ctaUrl = absoluteUrl("/academia");

  let sent = 0;
  let skippedOptOut = 0;
  let skippedEmpty = 0;
  let skippedNoEmail = 0;
  let failed = 0;

  try {
    // --- 3. Candidate users -------------------------------------------
    // Pull profiles + their preferences blob, capped per run. We filter the
    // opt-out in app code (the toggle is nested in JSONB; treating missing as
    // "on" can't be expressed cleanly as a single SQL predicate).
    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, preferences")
      .limit(MAX_USERS_PER_RUN);

    if (profErr) {
      console.error("[cron/academia-digest]", profErr.message);
      return NextResponse.json({ error: "Digest failed" }, { status: 500 });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromAddr = process.env.EMAIL_FROM;

    for (const p of profiles ?? []) {
      // Opt-out check: send when weekly_report is true OR absent; skip only
      // when explicitly false. (Default is true; missing means user hasn't
      // changed the on-by-default toggle.)
      const prefs = (p.preferences ?? {}) as {
        notifications?: { weekly_report?: unknown };
      };
      const wr = prefs.notifications?.weekly_report;
      if (wr === false) {
        skippedOptOut++;
        continue;
      }

      let items: DigestItem[];
      try {
        items = await loadAgenda(p.id, from, to);
      } catch (e) {
        console.error("[cron/academia-digest] agenda load failed", p.id, e);
        failed++;
        continue;
      }

      if (items.length === 0) {
        skippedEmpty++;
        continue;
      }

      // Resolve recipient email server-side (never from a stored column).
      let toEmail: string | undefined;
      try {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(p.id);
        toEmail = authUser?.user?.email ?? undefined;
      } catch (e) {
        console.error("[cron/academia-digest] getUserById failed", p.id, e);
      }
      if (!toEmail) {
        skippedNoEmail++;
        continue;
      }

      const agenda = buildAgendaHtml(items);
      const rendered = renderEmail(templates.academiaWeekly, {
        userName: (p.display_name as string | null) || undefined,
        itemCount: items.length,
        weekRangeLabel,
        agendaHtml: agenda.html,
        agendaText: agenda.text,
        ctaUrl,
        ctaLabel: "Open your planner",
        prefsUrl,
      });

      try {
        const { error: emailErr } = await resend.emails.send({
          from: fromAddr,
          to: toEmail,
          replyTo: "support@getlionade.com",
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        if (emailErr) {
          console.error("[cron/academia-digest] resend error", p.id, JSON.stringify(emailErr));
          failed++;
          continue;
        }
        sent++;
      } catch (e) {
        // One bad send must not abort the batch.
        console.error("[cron/academia-digest] send threw", p.id, e);
        failed++;
      }
    }

    const summary = {
      ok: true,
      window: { from, to },
      sent,
      skippedOptOut,
      skippedEmpty,
      skippedNoEmail,
      failed,
    };
    console.log("[cron/academia-digest] done", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[cron/academia-digest] unexpected", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
