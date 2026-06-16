// GET /api/cron/feature-health — Vercel cron entry point (every 5 minutes).
//
// AUTO-MAINTENANCE EVALUATOR. The self-healing half of the status/incidents
// system (companion to lib/feature-health.ts + lib/feature-flags.ts). Each pass
// turns the bounded 5xx firehose (feature_health_events, written fire-and-forget
// by recordFeatureError in guarded routes' 500 catch paths) into automatic,
// self-expiring 'warning' flags, and recovers its OWN auto flags once the errors
// subside. It NEVER sets 'maintenance' and NEVER touches a human override.
//
// --- WHAT IT DOES, exactly -------------------------------------------------
//   AUTO-FLAG: read the per-feature_key error count over the last 10 minutes.
//     For each key whose count >= ERROR_THRESHOLD, load its RAW feature_flags
//     row. We only auto-flag when the row is NOT a human override, i.e. its raw
//     status is 'live' (no human touched it) OR it is already an auto=true
//     'warning' (our own prior flag, which we re-extend). We UPSERT:
//       status      = 'warning'          (USABLE + banner; the API is NOT blocked)
//       auto        = true               (provenance: the evaluator set this)
//       message     = AUTO_MESSAGE       (dash-free, calm, user-facing)
//       starts_at   = null               (active immediately)
//       ends_at     = now + 20 min       (SELF-EXPIRING via the v2 read-time
//                                          window, so it auto-clears the moment
//                                          errors stop, even if this cron never
//                                          runs again — no recovery cron needed)
//       updated_by  = null               (no human actor)
//     Then openIncident(key,'warning',message,'auto') — idempotent, so
//     re-extending an existing auto-warning does NOT open a duplicate incident.
//
//   RECOVERY: for each RAW row that is status='warning' AND auto=true whose
//     recent error count < RECOVER_THRESHOLD, flip it back to status='live',
//     auto=false, ends_at=null, and closeOpenIncidents(key). (The window would
//     auto-clear it on read anyway; this makes the recovery EXPLICIT in the
//     stored row + closes the incident timeline promptly.)
//
//   NEVER 'maintenance' — that stays a deliberate human action.
//   NEVER an auto=false warning/maintenance row — that is a human override and
//     is left strictly alone.
//
// --- DEDUP of the support@ email -------------------------------------------
//   We email support@ ONCE per NEWLY auto-flagged feature, never on a re-extend.
//   The dedup is structural, not a ledger: openIncident is idempotent and tells
//   us (via a pre-check for an OPEN incident on the key) whether THIS pass is the
//   one that freshly opened the incident. We send the email only for keys that
//   had NO open incident before this pass. A sustained outage re-extends the
//   20-min window every 5 minutes but emails exactly once (until it recovers and
//   the incident closes; a fresh outage later re-opens + re-emails).
//
// --- Auth ------------------------------------------------------------------
//   Header-only Bearer CRON_SECRET, constant-time compare via timingSafeEqual,
//   fail-closed on unset (500). Copied verbatim from the sibling crons. The
//   secret is never logged or echoed in any code path.
//
// --- FAIL-OPEN / SAFE -------------------------------------------------------
//   This is the entire contract. NOTHING here may take the site down or block a
//   request path. The evaluator sets ONLY 'warning' (usable). Every read/write
//   is wrapped so a failure logs generically and contributes nothing; the pass
//   still returns ok. If email is unconfigured it is skipped silently. If the
//   tables/columns are absent the reads return empty and the pass is a no-op.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { SUPPORT_EMAIL, absoluteUrl } from "@/lib/site-config";
import { invalidateFeatureFlagCache } from "@/lib/feature-flags";
import { getFeature } from "@/lib/features/catalog";
import {
  getErrorCountsSince,
  openIncident,
  closeOpenIncidents,
} from "@/lib/feature-health";
import { putCronHeartbeat } from "@/lib/cloudwatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROUTE_TAG = "cron/feature-health";

// ── Thresholds + windows ───────────────────────────────────────────────────
// The trailing window the evaluator judges. The recordFeatureError firehose
// only writes within request handlers, so this is a bounded recent slice.
const HEALTH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
// >= this many 5xx in the window auto-flags a 'live' (or auto-'warning') feature.
const ERROR_THRESHOLD = 10;
// An auto 'warning' recovers to 'live' once its recent count drops BELOW this.
// Lower than ERROR_THRESHOLD so we do not flap on the boundary (hysteresis).
const RECOVER_THRESHOLD = 2;
// How long a fresh / re-extended auto-warning stays effective. Self-expiring via
// the v2 read-time window, so the feature returns to live on the next read even
// if this cron stops running.
const AUTO_WINDOW_MS = 20 * 60 * 1000; // 20 minutes

// User-facing, dash-free, calm. Shown as the warning banner on the feature.
const AUTO_MESSAGE =
  "Auto-flagged: elevated errors, our team is on it";

// getResend pattern (mirrors the sibling crons + contact/waitlist): returns null
// when RESEND_API_KEY is unset so the caller can skip silently.
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// RAW feature_flags row shape we care about here. The Supabase client is untyped
// (see the gap note at each .from()), so we narrow defensively in code.
type RawFlagRow = {
  key?: unknown;
  status?: unknown;
  auto?: unknown;
};

type LoadedFlag = {
  status: "live" | "warning" | "maintenance";
  auto: boolean;
};

function normStatus(value: unknown): "live" | "warning" | "maintenance" {
  if (value === "maintenance") return "maintenance";
  if (value === "warning") return "warning";
  return "live";
}

// Load ALL raw flag rows once (key -> {status, auto}). Bounded: one row per
// catalog key at most. Returns {} on any error (fail-open: no rows => the auto
// pass simply treats every flagged feature as 'live' and a struggling feature
// as freshly auto-flaggable, which is the safe direction).
async function loadRawFlags(): Promise<Record<string, LoadedFlag>> {
  try {
    // NOTE (documented Supabase-type gap): untyped .from() — the feature_flags
    // table (incl. the `auto` column from 20260616170000) is applied manually
    // and is not in the generated Supabase types. Columns match those
    // migrations exactly.
    const { data, error } = await supabaseAdmin
      .from("feature_flags")
      .select("key, status, auto");

    if (error) {
      console.error(`[${ROUTE_TAG}] loadRawFlags`, error.message);
      return {};
    }

    const out: Record<string, LoadedFlag> = {};
    for (const row of (data ?? []) as RawFlagRow[]) {
      if (typeof row.key !== "string") continue;
      out[row.key] = {
        status: normStatus(row.status),
        auto: row.auto === true,
      };
    }
    return out;
  } catch (err) {
    console.error(
      `[${ROUTE_TAG}] loadRawFlags`,
      err instanceof Error ? err.message : "unknown",
    );
    return {};
  }
}

// Is there already an OPEN incident (ended_at IS NULL) for this key? Used to
// decide whether THIS pass is the one that freshly opens the incident, which in
// turn dedups the support@ email. Fail-CLOSED for the email side (treat a read
// error as "already open" => do NOT email) so a transient DB blip cannot trigger
// an email storm; the auto-flag itself still happens regardless.
async function hasOpenIncident(featureKey: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("incidents")
      .select("id")
      .eq("feature_key", featureKey)
      .is("ended_at", null)
      .limit(1);
    if (error) {
      console.error(`[${ROUTE_TAG}] hasOpenIncident`, error.message);
      return true;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    console.error(
      `[${ROUTE_TAG}] hasOpenIncident`,
      err instanceof Error ? err.message : "unknown",
    );
    return true;
  }
}

// Upsert an auto 'warning' for a key with a fresh self-expiring window. Returns
// true only on a confirmed write. Never throws.
async function writeAutoWarning(
  featureKey: string,
  now: number,
): Promise<boolean> {
  try {
    const endsAt = new Date(now + AUTO_WINDOW_MS).toISOString();
    // NOTE (documented Supabase-type gap): untyped .from() upsert — columns
    // match feature_flags exactly (incl. v2 starts_at/ends_at and the v3 `auto`
    // column). starts_at=null means active immediately; ends_at self-expires the
    // flag via the read-time window. updated_by=null => no human actor.
    const { error } = await supabaseAdmin.from("feature_flags").upsert(
      {
        key: featureKey,
        status: "warning",
        auto: true,
        message: AUTO_MESSAGE,
        starts_at: null,
        ends_at: endsAt,
        updated_by: null,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) {
      console.error(`[${ROUTE_TAG}] writeAutoWarning`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[${ROUTE_TAG}] writeAutoWarning`,
      err instanceof Error ? err.message : "unknown",
    );
    return false;
  }
}

// Recover an auto 'warning' back to 'live' (auto=false, window cleared). Returns
// true only on a confirmed write. Never throws.
async function writeRecovery(featureKey: string, now: number): Promise<boolean> {
  try {
    // NOTE (documented Supabase-type gap): untyped .from() update — columns
    // match feature_flags exactly. ends_at=null clears the self-expiry window;
    // auto=false hands the row back to the "no override" baseline.
    const { error } = await supabaseAdmin
      .from("feature_flags")
      .update({
        status: "live",
        auto: false,
        message: null,
        starts_at: null,
        ends_at: null,
        updated_by: null,
        updated_at: new Date(now).toISOString(),
      })
      .eq("key", featureKey);
    if (error) {
      console.error(`[${ROUTE_TAG}] writeRecovery`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[${ROUTE_TAG}] writeRecovery`,
      err instanceof Error ? err.message : "unknown",
    );
    return false;
  }
}

// One-time support@ email for a freshly auto-flagged feature. Dash-free, names
// the concrete feature + error count, carries NO secrets, links to the admin
// security console. Returns true only on a confirmed send; failure is logged and
// non-fatal (the auto-flag already happened).
async function sendAutoFlagEmail(
  resend: Resend,
  fromAddr: string,
  featureKey: string,
  label: string,
  count: number,
): Promise<boolean> {
  const consoleUrl = absoluteUrl("/admin/security");
  const subject = `Lionade auto-maintenance: ${label} flagged`;
  const text = [
    "The auto-maintenance evaluator flagged a feature into a temporary warning state on Lionade.",
    "",
    `Feature: ${label} (${featureKey})`,
    `Recent errors in the last 10 minutes: ${count}`,
    "State: warning. The feature stays usable and shows a known-issue banner. It was NOT taken offline.",
    "This auto-flag self-expires after 20 minutes and clears on its own once the errors stop.",
    "",
    `Review it here: ${consoleUrl}`,
    "",
    "This is an automated alert. You will not be paged again for this feature until it recovers and a new issue starts.",
  ].join("\n");
  const html =
    `<p>The auto-maintenance evaluator flagged a feature into a temporary warning state on Lionade.</p>` +
    `<p><strong>Feature:</strong> ${label} (${featureKey})<br />` +
    `<strong>Recent errors in the last 10 minutes:</strong> ${count}<br />` +
    `<strong>State:</strong> warning. The feature stays usable and shows a known-issue banner. It was NOT taken offline.<br />` +
    `This auto-flag self-expires after 20 minutes and clears on its own once the errors stop.</p>` +
    `<p><a href="${consoleUrl}">Review it in the admin console</a></p>` +
    `<p>This is an automated alert. You will not be paged again for this feature until it recovers and a new issue starts.</p>`;
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: SUPPORT_EMAIL,
      subject,
      html,
      text,
    });
    if (error) {
      console.error(`[${ROUTE_TAG}] email error`, JSON.stringify(error));
      return false;
    }
    return true;
  } catch (e) {
    console.error(
      `[${ROUTE_TAG}] email threw`,
      e instanceof Error ? e.message : "unknown",
    );
    return false;
  }
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
  let autoFlagged = 0;
  let recovered = 0;
  let checked = 0;
  let wrote = false;

  try {
    // --- 2. Email config gate (skip silently, not an error) -------------
    const resend = getResend();
    const fromAddr = process.env.EMAIL_FROM;
    const emailReady = resend !== null && Boolean(fromAddr);
    if (!emailReady) {
      console.error(`[${ROUTE_TAG}] email not configured; auto-flag emails skipped`);
    }

    // --- 3. Read recent error counts + current raw flag rows ------------
    const sinceIso = new Date(now - HEALTH_WINDOW_MS).toISOString();
    const [counts, rawFlags] = await Promise.all([
      getErrorCountsSince(sinceIso),
      loadRawFlags(),
    ]);

    // --- 4. AUTO-FLAG struggling features -------------------------------
    // A key qualifies when its recent count >= ERROR_THRESHOLD AND it is not a
    // human override: either no row / status 'live' (no human touched it) OR an
    // existing auto=true 'warning' (our own prior flag, which we re-extend).
    for (const [featureKey, count] of Object.entries(counts)) {
      if (count < ERROR_THRESHOLD) continue;
      checked++;

      const existing = rawFlags[featureKey];
      const isLive = existing === undefined || existing.status === "live";
      const isOwnAutoWarning =
        existing !== undefined &&
        existing.status === "warning" &&
        existing.auto === true;

      // Skip any human override: auto=false warning/maintenance, or ANY
      // maintenance (the evaluator never owns maintenance). Leave it untouched.
      if (!isLive && !isOwnAutoWarning) continue;

      // DEDUP: did an incident already exist for this key BEFORE this pass? If
      // not, this pass freshly opens it and we email once.
      const wasOpenBefore = await hasOpenIncident(featureKey);

      const ok = await writeAutoWarning(featureKey, now);
      if (!ok) continue;
      wrote = true;

      // Idempotent: re-extending an open auto-warning does not duplicate.
      await openIncident(featureKey, "warning", AUTO_MESSAGE, "auto");
      autoFlagged++;

      // One-time email only for a freshly opened incident.
      if (!wasOpenBefore && emailReady && resend && fromAddr) {
        const label = getFeature(featureKey)?.label ?? featureKey;
        await sendAutoFlagEmail(resend, fromAddr, featureKey, label, count);
      }
    }

    // --- 5. RECOVER our own auto-warnings that have calmed down ---------
    for (const [featureKey, flag] of Object.entries(rawFlags)) {
      if (flag.status !== "warning" || flag.auto !== true) continue;
      const recentCount = counts[featureKey] ?? 0;
      if (recentCount >= RECOVER_THRESHOLD) continue;
      checked++;

      const ok = await writeRecovery(featureKey, now);
      if (!ok) continue;
      wrote = true;
      await closeOpenIncidents(featureKey);
      recovered++;
    }

    // --- 6. Invalidate the flag cache so reads pick up our writes -------
    if (wrote) invalidateFeatureFlagCache();

    // --- 7. Prune the firehose. The evaluator only ever reads the last
    // 10 minutes, so anything older than an hour is dead weight. Bounds the
    // feature_health_events table under sustained 5xx. Best-effort, fail-open.
    try {
      const pruneBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await supabaseAdmin
        .from("feature_health_events")
        .delete()
        .lt("observed_at", pruneBefore);
    } catch (pruneErr) {
      console.error(
        `[${ROUTE_TAG}] prune`,
        pruneErr instanceof Error ? pruneErr.message : "unknown",
      );
    }

    const summary = { ok: true, autoFlagged, recovered, checked };
    console.log(`[${ROUTE_TAG}] done`, JSON.stringify(summary));
    await putCronHeartbeat("feature-health");
    return NextResponse.json(summary);
  } catch (e) {
    // Last-resort fail-open: never throw out of the cron. Log generically.
    console.error(
      `[${ROUTE_TAG}] unexpected`,
      e instanceof Error ? e.message : "unknown",
    );
    return NextResponse.json({ ok: true, autoFlagged, recovered, checked });
  }
}
