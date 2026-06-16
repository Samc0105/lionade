// GET /api/cron/security-alerts — Vercel cron entry point (every 10 minutes).
//
// SOC alert sweep: turns the passive security telemetry (security_events +
// request_telemetry_rollup, see the security_monitoring migration) into PUSH
// notifications so an attack does not sit unseen until someone opens the admin
// console. Two detectors run each pass and email support@ when they trip:
//
//   (1) HIGH-THREAT IP — a single IP that has racked up serious offender
//       signal (scanner / bruteforce / admin_probe / enumeration) over the last
//       60 minutes, summed across its security_events rows. Threshold below.
//   (2) TRAFFIC SPIKE — the most recent COMPLETE minute of total request volume
//       (from the IP-free rollup) standing far above the trailing baseline,
//       i.e. an absolute floor AND a multiple of the trailing median. This
//       catches a flood that the rate limiter is allowing through (or a real
//       organic surge worth eyeballing).
//
// DEDUP via the security_alerts_sent ledger (feature_flags_v2 migration): a
// dedup_key is checked before sending and inserted only AFTER a confirmed send,
// so a sustained attack does not re-email every 10 minutes. High-threat IPs are
// keyed per IP + UTC hour; spikes are keyed per spiking minute.
//
// --- Auth -----------------------------------------------------------------
// Header-only Bearer CRON_SECRET, constant-time compare via timingSafeEqual,
// fail-closed on unset (500). Copied verbatim from the sibling crons
// (team-mfa-enforce / streak-reminder / academia-digest). The secret is never
// logged or echoed in any code path.
//
// --- FAIL-OPEN / safety ---------------------------------------------------
// This is a read-and-email job. It NEVER mutates app state, never blocks a
// request path, and never touches the feature-flag tables. If email is not
// configured it skips silently (returns ok with zero sends). A read failure on
// either detector is logged generically and that detector contributes zero
// alerts; the other detector still runs. Nothing here can take the site down.
//
// --- Audit ----------------------------------------------------------------
// NONE. This is an automated job, not an admin action; it writes only to
// security_alerts_sent (the dedup ledger). No admin_audit_log rows.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { SUPPORT_EMAIL, absoluteUrl } from "@/lib/site-config";
import { putCronHeartbeat } from "@/lib/cloudwatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROUTE_TAG = "cron/security-alerts";

// getResend pattern (mirrors app/api/contact + app/api/waitlist): returns null
// when RESEND_API_KEY is unset so the caller can skip silently.
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// ── Detector 1: high-threat IP ───────────────────────────────────────────
// Lookback for the per-IP offender sum.
const THREAT_LOOKBACK_MS = 60 * 60 * 1000;
// Categories that count toward the threat sum. Tame signals (bot / flood /
// auth_failure / denylist_hit) are deliberately excluded so a noisy-but-benign
// crawler does not page us.
const THREAT_CATEGORIES = [
  "scanner",
  "bruteforce",
  "admin_probe",
  "enumeration",
] as const;
// An IP must clear this summed event count (sum of security_events.count over
// the lookback) to alert.
const THREAT_MIN_TOTAL = 20;
// Safety bound on rows scanned so a flood cannot blow up the aggregation.
const THREAT_MAX_EVENTS_SCANNED = 5000;

// ── Detector 2: traffic spike ────────────────────────────────────────────
// Window of complete minutes used to build the baseline + find the spike. ~30
// minutes of trailing data, plus we ignore the current (incomplete) minute.
const SPIKE_LOOKBACK_MS = 31 * 60 * 1000;
// The spiking minute must clear this absolute floor (so a tiny-traffic blip of
// 1 -> 6 does not page us) AND be at least SPIKE_MULTIPLE x the trailing median.
const SPIKE_MIN_TOTAL = 200;
const SPIKE_MULTIPLE = 5;
// Rollup rows scanned bound (<= ~31 min x ~45 prefixes x 3 decisions).
const SPIKE_MAX_ROWS_SCANNED = 5000;

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Floor an ISO timestamp to its minute boundary, returned as ISO.
function minuteIso(ts: string | Date): string {
  const d = new Date(ts);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

// Raw security_events row shape (untyped Supabase client; see gap note below).
type EventRow = { ip: unknown; category: unknown; count: unknown };
// Raw request_telemetry_rollup row shape.
type RollupRow = { bucket_minute: unknown; count: unknown };

type ThreatAlert = { ip: string; total: number; dedupKey: string };
type SpikeAlert = {
  minute: string;
  total: number;
  baseline: number;
  dedupKey: string;
};

// ── Email senders ─────────────────────────────────────────────────────────
// Both bodies are dash-free, name the concrete signal, carry NO secrets, and
// link to the admin security console. Returns true only on a confirmed send.

async function sendThreatEmail(
  resend: Resend,
  fromAddr: string,
  alert: ThreatAlert,
): Promise<boolean> {
  const consoleUrl = absoluteUrl("/admin/security");
  const subject = `Lionade security: high-threat IP ${alert.ip}`;
  const text = [
    "A single IP crossed the high-threat alert threshold on Lionade.",
    "",
    `IP: ${alert.ip}`,
    `Offender events in the last 60 minutes: ${alert.total}`,
    "Categories counted: scanner, bruteforce, admin probe, enumeration.",
    "",
    `Review and block it here: ${consoleUrl}`,
    "",
    "This is an automated alert. You will not be paged again for this IP this hour.",
  ].join("\n");
  const html =
    `<p>A single IP crossed the high-threat alert threshold on Lionade.</p>` +
    `<p><strong>IP:</strong> ${alert.ip}<br />` +
    `<strong>Offender events in the last 60 minutes:</strong> ${alert.total}<br />` +
    `Categories counted: scanner, bruteforce, admin probe, enumeration.</p>` +
    `<p><a href="${consoleUrl}">Review and block it in the security console</a></p>` +
    `<p>This is an automated alert. You will not be paged again for this IP this hour.</p>`;
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: SUPPORT_EMAIL,
      subject,
      html,
      text,
    });
    if (error) {
      console.error(`[${ROUTE_TAG}] threat email error`, JSON.stringify(error));
      return false;
    }
    return true;
  } catch (e) {
    console.error(
      `[${ROUTE_TAG}] threat email threw`,
      e instanceof Error ? e.message : "unknown",
    );
    return false;
  }
}

async function sendSpikeEmail(
  resend: Resend,
  fromAddr: string,
  alert: SpikeAlert,
): Promise<boolean> {
  const consoleUrl = absoluteUrl("/admin/security");
  const subject = `Lionade security: traffic spike at ${alert.minute}`;
  const text = [
    "Request volume spiked well above the recent baseline on Lionade.",
    "",
    `Minute: ${alert.minute}`,
    `Requests in that minute: ${alert.total}`,
    `Trailing baseline (median requests per minute): ${alert.baseline}`,
    "",
    `Review live traffic here: ${consoleUrl}`,
    "",
    "This is an automated alert. You will not be paged again for this minute.",
  ].join("\n");
  const html =
    `<p>Request volume spiked well above the recent baseline on Lionade.</p>` +
    `<p><strong>Minute:</strong> ${alert.minute}<br />` +
    `<strong>Requests in that minute:</strong> ${alert.total}<br />` +
    `<strong>Trailing baseline (median requests per minute):</strong> ${alert.baseline}</p>` +
    `<p><a href="${consoleUrl}">Review live traffic in the security console</a></p>` +
    `<p>This is an automated alert. You will not be paged again for this minute.</p>`;
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: SUPPORT_EMAIL,
      subject,
      html,
      text,
    });
    if (error) {
      console.error(`[${ROUTE_TAG}] spike email error`, JSON.stringify(error));
      return false;
    }
    return true;
  } catch (e) {
    console.error(
      `[${ROUTE_TAG}] spike email threw`,
      e instanceof Error ? e.message : "unknown",
    );
    return false;
  }
}

// Check whether a dedup_key was already emailed. Fail-CLOSED on a read error
// (treat as already-sent => skip the email) so a transient DB blip cannot spam
// support@. A missed alert is recoverable; an email storm is not.
async function alreadySent(dedupKey: string): Promise<boolean> {
  // NOTE (documented Supabase-type gap): supabaseAdmin is built without a
  // generated Database generic, so .from(...) is untyped. Columns match
  // security_alerts_sent in the feature_flags_v2 migration exactly.
  const { data, error } = await supabaseAdmin
    .from("security_alerts_sent")
    .select("dedup_key")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  if (error) {
    console.error(`[${ROUTE_TAG}] dedup read failed`, error.message);
    return true;
  }
  return data !== null;
}

// Record a dedup_key after a confirmed send. A failure here is logged but not
// fatal: at worst the same alert re-sends on the next pass (bounded), which is
// the safe direction for a security page.
async function markSent(dedupKey: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("security_alerts_sent")
    .insert({ dedup_key: dedupKey });
  if (error) {
    console.error(`[${ROUTE_TAG}] dedup insert failed`, error.message);
  }
}

// ── Detector 1 evaluation ──────────────────────────────────────────────────
async function evaluateThreats(now: number): Promise<ThreatAlert[]> {
  const sinceIso = new Date(now - THREAT_LOOKBACK_MS).toISOString();

  // NOTE (documented Supabase-type gap): untyped .from() — columns match the
  // security_events table in the security_monitoring migration exactly.
  const res = await supabaseAdmin
    .from("security_events")
    .select("ip, category, count")
    .gte("observed_at", sinceIso)
    .in("category", THREAT_CATEGORIES as unknown as string[])
    .order("observed_at", { ascending: false })
    .limit(THREAT_MAX_EVENTS_SCANNED);

  if (res.error) {
    // Fail-open for the detector: log generically, contribute zero alerts.
    console.error(`[${ROUTE_TAG}] threats read`, res.error.message);
    return [];
  }

  // PostgREST cannot GROUP BY, so fold per IP in JS. Row count is bounded by
  // THREAT_MAX_EVENTS_SCANNED.
  const totalByIp = new Map<string, number>();
  for (const raw of (res.data ?? []) as EventRow[]) {
    const ip = typeof raw.ip === "string" ? raw.ip.trim() : "";
    if (ip === "") continue;
    const c = Math.max(1, toInt(raw.count));
    totalByIp.set(ip, (totalByIp.get(ip) ?? 0) + c);
  }

  // UTC date+hour bucket so dedup is per IP per hour. setUTCMinutes(0,0,0) then
  // slice to "YYYY-MM-DDTHH" keeps the key human-readable and timezone-stable.
  const hourBucket = new Date(now);
  hourBucket.setUTCMinutes(0, 0, 0);
  const hourTag = hourBucket.toISOString().slice(0, 13);

  const alerts: ThreatAlert[] = [];
  for (const [ip, total] of Array.from(totalByIp.entries())) {
    if (total < THREAT_MIN_TOTAL) continue;
    alerts.push({ ip, total, dedupKey: `threat:${ip}:${hourTag}` });
  }
  return alerts;
}

// ── Detector 2 evaluation ──────────────────────────────────────────────────
async function evaluateSpike(now: number): Promise<SpikeAlert | null> {
  const sinceIso = new Date(now - SPIKE_LOOKBACK_MS).toISOString();

  // NOTE (documented Supabase-type gap): untyped .from() — columns match the
  // request_telemetry_rollup table in the security_monitoring migration.
  const res = await supabaseAdmin
    .from("request_telemetry_rollup")
    .select("bucket_minute, count")
    .gte("bucket_minute", sinceIso)
    .order("bucket_minute", { ascending: true })
    .limit(SPIKE_MAX_ROWS_SCANNED);

  if (res.error) {
    console.error(`[${ROUTE_TAG}] spike read`, res.error.message);
    return null;
  }

  // Sum total requests per minute across all key_prefix x decision rows.
  const totalByMinute = new Map<string, number>();
  for (const raw of (res.data ?? []) as RollupRow[]) {
    const bucketRaw = raw.bucket_minute;
    if (typeof bucketRaw !== "string" && !(bucketRaw instanceof Date)) continue;
    const m = minuteIso(bucketRaw as string);
    const c = toInt(raw.count);
    if (c <= 0) continue;
    totalByMinute.set(m, (totalByMinute.get(m) ?? 0) + c);
  }
  if (totalByMinute.size === 0) return null;

  // Ignore the current (still-filling) minute so we only judge complete ones.
  const currentMinute = minuteIso(new Date(now));
  const minutes = Array.from(totalByMinute.entries())
    .filter(([m]) => m !== currentMinute)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (minutes.length === 0) return null;

  // Newest complete minute is the candidate; the rest form the baseline.
  const [candMinute, candTotal] = minutes[minutes.length - 1];
  const baselineValues = minutes.slice(0, -1).map(([, v]) => v);
  const baseline = median(baselineValues);

  // Need an absolute floor AND a multiple of the median. When baseline is 0 we
  // require only the absolute floor (any nonzero median otherwise gates the
  // multiple). Both guards prevent paging on low-traffic noise.
  const clearsFloor = candTotal >= SPIKE_MIN_TOTAL;
  const clearsMultiple = baseline === 0 ? true : candTotal >= SPIKE_MULTIPLE * baseline;
  if (!clearsFloor || !clearsMultiple) return null;

  return {
    minute: candMinute,
    total: candTotal,
    baseline: Math.round(baseline),
    dedupKey: `spike:${candMinute}`,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // --- 1. Auth -----------------------------------------------------------
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(`[${ROUTE_TAG}] CRON_SECRET not configured`);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const aBuf = Buffer.from(authHeader);
  const eBuf = Buffer.from(expected);
  if (aBuf.length !== eBuf.length || !timingSafeEqual(aBuf, eBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  let threatAlerts = 0;
  let spikeAlerts = 0;
  let checked = 0;

  try {
    // --- 2. Email config gate (skip silently, not an error) -------------
    // Per the contract: an unconfigured Resend means the job still runs as a
    // no-op (it must never 500 just because email is off). The detectors are
    // still evaluated so `checked` reflects work done.
    const resend = getResend();
    const fromAddr = process.env.EMAIL_FROM;
    const emailReady = resend !== null && Boolean(fromAddr);
    if (!emailReady) {
      console.error(`[${ROUTE_TAG}] email not configured; running detectors as no-op`);
    }

    // --- 3. Run both detectors (each is independently fail-open) --------
    const [threats, spike] = await Promise.all([
      evaluateThreats(now),
      evaluateSpike(now),
    ]);
    checked = threats.length + (spike ? 1 : 0);

    // --- 4. High-threat IP alerts ---------------------------------------
    if (emailReady && resend && fromAddr) {
      for (const alert of threats) {
        if (await alreadySent(alert.dedupKey)) continue;
        const ok = await sendThreatEmail(resend, fromAddr, alert);
        if (ok) {
          await markSent(alert.dedupKey);
          threatAlerts++;
        }
      }

      // --- 5. Traffic spike alert ---------------------------------------
      if (spike && !(await alreadySent(spike.dedupKey))) {
        const ok = await sendSpikeEmail(resend, fromAddr, spike);
        if (ok) {
          await markSent(spike.dedupKey);
          spikeAlerts++;
        }
      }
    }

    const summary = { ok: true, threatAlerts, spikeAlerts, checked };
    console.log(`[${ROUTE_TAG}] done`, JSON.stringify(summary));
    await putCronHeartbeat("security-alerts");
    return NextResponse.json(summary);
  } catch (e) {
    // Last-resort fail-open: never throw out of the cron. Log generically.
    console.error(
      `[${ROUTE_TAG}] unexpected`,
      e instanceof Error ? e.message : "unknown",
    );
    return NextResponse.json({ ok: true, threatAlerts, spikeAlerts, checked });
  }
}
