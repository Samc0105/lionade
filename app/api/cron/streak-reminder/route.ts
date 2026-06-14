// GET /api/cron/streak-reminder — Vercel cron entry point.
//
// DORMANT: this route is BUILT and verified but intentionally NOT wired into
// vercel.json yet. It sends real email that I can't eyeball autonomously, so
// activation waits on Sam: (1) preview the rendered template at
// `/dev/emails?template=streakReminder`, (2) confirm RESEND_API_KEY + EMAIL_FROM
// + CRON_SECRET are set in Vercel prod, (3) add a `crons` entry pointing here
// (suggested schedule below), (4) redeploy. Until then it 404s in prod because
// Vercel only routes cron paths it knows about (a manual GET still works with
// the Bearer secret, which is how Sam can smoke-test a single real send).
//
// SUGGESTED SCHEDULE: once daily at a globally-reasonable hour, e.g. 21:00 UTC
// (≈5pm ET / 2pm PT) so the nudge lands in the user's afternoon/evening, when a
// "do one quiz before bed" ask is most actionable:
//   { "path": "/api/cron/streak-reminder", "schedule": "0 21 * * *" }
//
// --- What it does ---------------------------------------------------------
// Emails users whose streak is ALIVE but about to lapse. The streak-increment
// window (save-quiz-results) is "20h to 48h since last_activity_at": a quiz
// inside that window ticks the streak, past 48h it resets. We target users whose
// last activity was REMINDER_MIN_GAP_H..REMINDER_MAX_GAP_H ago (24h..44h), so a
// quiz today still counts AND they have at least ~4h of runway left before the
// 48h cliff. streak must be >= STREAK_MIN (a 1-day streak isn't worth a panic
// email and would collide with the day-1 "you're cooking" mail).
//
// --- Auth (copied verbatim from academia-digest) --------------------------
// Header-only Bearer CRON_SECRET, constant-time compare, fail-closed on unset.
//
// --- Eligibility ----------------------------------------------------------
// EMAIL channel toggle `preferences.notifications_email.streak_alert` (default
// ON; skip only when explicitly false), mirroring emailEnabled() and the
// academia-digest inline read. Independent of the in-app streak_alert card.
//
// --- Idempotency ----------------------------------------------------------
// `profiles.streak_reminder_sent_at` (migration 074). Self-resetting gate: we
// send only when the marker is null OR strictly older than last_activity_at, and
// stamp now() on send. The next time the user studies, last_activity_at jumps
// past the marker and re-arms the reminder for their next at-risk window. So a
// single streak-session yields at most one reminder even across many cron runs.
//
// --- Recipient email ------------------------------------------------------
// Resolved server-side via supabaseAdmin.auth.admin.getUserById (never a stored
// column), same as academia-digest + auth/welcome.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { renderEmail, templates } from "@/lib/emails";
import { absoluteUrl } from "@/lib/site-config";
import { putCronHeartbeat } from "@/lib/cloudwatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Candidate cap per run (safety bound; current base is small). Add a cursor if
// the at-risk cohort ever exceeds this.
const MAX_USERS_PER_RUN = 500;

// At-risk window, in hours since last_activity_at. Must sit INSIDE the
// 20h..48h streak-increment window with runway to spare: 24h ensures the nudge
// fires only after "today" has clearly begun (not the same study session), and
// 44h leaves >= ~4h before the 48h reset cliff.
const REMINDER_MIN_GAP_H = 24;
const REMINDER_MAX_GAP_H = 44;

// Don't nag for a 1-day streak (low stakes + would shadow the day-1 email).
const STREAK_MIN = 2;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function GET(req: NextRequest) {
  // --- 1. Auth ----------------------------------------------------------
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/streak-reminder] CRON_SECRET not configured");
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
    console.error("[cron/streak-reminder] RESEND_API_KEY or EMAIL_FROM missing");
    return NextResponse.json({ error: "Email not configured" }, { status: 500 });
  }

  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  // last_activity_at must fall in [now - MAX_GAP, now - MIN_GAP]. Older bound is
  // the MAX gap (further in the past); newer bound is the MIN gap.
  const olderBound = new Date(now - REMINDER_MAX_GAP_H * HOUR).toISOString();
  const newerBound = new Date(now - REMINDER_MIN_GAP_H * HOUR).toISOString();
  const nowIso = new Date(now).toISOString();

  const prefsUrl = absoluteUrl("/settings");
  const ctaUrl = absoluteUrl("/quiz");

  let sent = 0;
  let skippedOptOut = 0;
  let skippedAlreadySent = 0;
  let skippedNoEmail = 0;
  let failed = 0;

  try {
    // --- 3. Candidate users — at-risk streaks in the gap window --------
    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, streak, preferences, last_activity_at, streak_reminder_sent_at")
      .gt("streak", STREAK_MIN - 1)
      .gte("last_activity_at", olderBound)
      .lte("last_activity_at", newerBound)
      .order("last_activity_at", { ascending: true })
      .limit(MAX_USERS_PER_RUN);

    if (profErr) {
      console.error("[cron/streak-reminder]", profErr.message);
      return NextResponse.json({ error: "Reminder failed" }, { status: 500 });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromAddr = process.env.EMAIL_FROM;

    for (const p of profiles ?? []) {
      // EMAIL opt-out: streak_alert email default ON; skip only if false.
      const prefs = (p.preferences ?? {}) as {
        notifications_email?: { streak_alert?: unknown };
      };
      if (prefs.notifications_email?.streak_alert === false) {
        skippedOptOut++;
        continue;
      }

      // Idempotency: skip if we've already reminded for THIS streak-session
      // (marker is at or after the current last_activity_at). The query can't
      // compare two columns, so we do it here.
      const lastActivity = p.last_activity_at as string | null;
      const sentAt = p.streak_reminder_sent_at as string | null;
      if (sentAt && lastActivity && sentAt >= lastActivity) {
        skippedAlreadySent++;
        continue;
      }

      // Recipient email — server-resolved, never a stored column.
      let toEmail: string | undefined;
      try {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(p.id);
        toEmail = authUser?.user?.email ?? undefined;
      } catch (e) {
        console.error("[cron/streak-reminder] getUserById failed", p.id, e);
      }
      if (!toEmail) {
        skippedNoEmail++;
        continue;
      }

      const rawName = (p.display_name as string | null) || "";
      const safeName = rawName ? escapeHtml(rawName) : undefined;
      const rendered = renderEmail(templates.streakReminder, {
        userName: safeName,
        streakDays: (p.streak as number) ?? STREAK_MIN,
        ctaUrl,
        ctaLabel: "Save my streak",
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
          console.error("[cron/streak-reminder] resend error", p.id, JSON.stringify(emailErr));
          failed++;
          continue;
        }
        // Stamp the idempotency marker only AFTER a confirmed send so a failed
        // send is retried on the next run (still inside the window).
        const { error: stampErr } = await supabaseAdmin
          .from("profiles")
          .update({ streak_reminder_sent_at: nowIso })
          .eq("id", p.id);
        if (stampErr) {
          console.error("[cron/streak-reminder] stamp failed", p.id, stampErr.message);
          // Sent succeeded; a missing stamp risks a duplicate next run. Logged,
          // not fatal — bounded to at most one extra email.
        }
        sent++;
      } catch (e) {
        console.error("[cron/streak-reminder] send threw", p.id, e);
        failed++;
      }
    }

    const summary = {
      ok: true,
      window: { olderBound, newerBound },
      sent,
      skippedOptOut,
      skippedAlreadySent,
      skippedNoEmail,
      failed,
    };
    console.log("[cron/streak-reminder] done", JSON.stringify(summary));
    await putCronHeartbeat("streak-reminder");
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[cron/streak-reminder] unexpected", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
