// POST /api/library/[id]/report — flag a public study set for review.
//
// Body: { reason: string }  (1..280 chars)
//
// Minor-audience safety net for the Community Library. Guards, in order:
//   - reporter account must be >= MIN_REPORTER_ACCOUNT_AGE_DAYS (7) days old
//   - the target set must exist AND currently be public
//   - per-user cap of MAX_REPORTS_PER_DAY (3) reports per UTC day
//   - one OPEN report per user per set (partial unique index — 23505 resolves
//     to an idempotent alreadyReported response)
// When REPORT_AUTO_UNPUBLISH_THRESHOLD (3) DISTINCT users have open reports,
// the set is auto-unpublished service-side on insert; the publish route
// refuses to republish it while those reports stay open (dismissing them in
// the admin queue clears the block). Reports land in library_reports (status
// "open") for GET/PATCH /api/admin/library-reports.
//
// Demo-blocked: 3 reports nuke a set from the library, so the shared demo
// account can't be allowed to stack them.
//
// FAIL-SOFT (HELD addendum 20260702140000 unapplied): library_reports is
// missing -> 42P01 -> 503 { unavailable: true } with honest copy.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import {
  isMissingLibrarySchema,
  libraryUnavailableResponse,
} from "@/lib/library/schema-guard";
import {
  MAX_REPORT_REASON_LENGTH,
  MAX_REPORTS_PER_DAY,
  MIN_REPORTER_ACCOUNT_AGE_DAYS,
  REPORT_AUTO_UNPUBLISH_THRESHOLD,
  STUDY_SETS_TABLE,
  LIBRARY_REPORTS_TABLE,
} from "@/lib/library/constants";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  if (isDemoUser(userId)) return demoBlockedResponse();

  const setId = params.id;
  if (!setId || typeof setId !== "string") {
    return NextResponse.json({ error: "Missing set id" }, { status: 400 });
  }

  let reason = "";
  try {
    const body = (await req.json()) as { reason?: unknown } | null;
    if (typeof body?.reason === "string") reason = body.reason.trim();
  } catch {
    // fall through to the 400 below
  }
  if (!reason || reason.length > MAX_REPORT_REASON_LENGTH) {
    return NextResponse.json(
      { error: `Tell us what's wrong in up to ${MAX_REPORT_REASON_LENGTH} characters.` },
      { status: 400 },
    );
  }

  // ── Reporter account age floor (brigade guard: 3 fresh throwaways hitting
  //    the auto-unpublish threshold is the obvious abuse vector) ────────────
  const { data: reporterProfile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("created_at")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr || !reporterProfile) {
    console.error("[library/report] reporter lookup", profileErr?.message ?? "no profile");
    return NextResponse.json({ error: "Couldn't send the report." }, { status: 500 });
  }
  const accountAgeMs = Date.now() - new Date(String(reporterProfile.created_at)).getTime();
  if (!Number.isFinite(accountAgeMs) || accountAgeMs < MIN_REPORTER_ACCOUNT_AGE_DAYS * 86_400_000) {
    return NextResponse.json(
      {
        error: `Your account needs to be at least ${MIN_REPORTER_ACCOUNT_AGE_DAYS} days old to report sets.`,
      },
      { status: 403 },
    );
  }

  // ── Target must exist AND be public. Reports exist to pull bad content out
  //    of the public library; a private set isn't in front of anyone, and
  //    letting non-public sets accumulate reports would let a brigade pre-load
  //    an auto-unpublish + republish block before the owner ever publishes. ──
  const { data: set, error: setErr } = await supabaseAdmin
    .from(STUDY_SETS_TABLE)
    .select("id, user_id, is_public")
    .eq("id", setId)
    .maybeSingle();
  if (setErr) {
    if (isMissingLibrarySchema(setErr)) return libraryUnavailableResponse();
    console.error("[library/report] set lookup", setErr.message);
    return NextResponse.json({ error: "Couldn't send the report." }, { status: 500 });
  }
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  if (set.is_public !== true) {
    return NextResponse.json(
      { error: "This set isn't public, so it can't be reported." },
      { status: 400 },
    );
  }
  if (set.user_id === userId) {
    return NextResponse.json(
      { error: "That's your own set. You can unpublish it from the set page." },
      { status: 400 },
    );
  }

  // ── Per-user daily report cap (any set, any status) ──────────────────────
  const todayUtc = new Date().toISOString().slice(0, 10);
  const { count: reportsToday, error: capErr } = await supabaseAdmin
    .from(LIBRARY_REPORTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("reporter", userId)
    .gte("created_at", `${todayUtc}T00:00:00.000Z`);
  if (capErr) {
    if (isMissingLibrarySchema(capErr)) return libraryUnavailableResponse();
    console.error("[library/report] cap count", capErr.message);
    return NextResponse.json({ error: "Couldn't send the report." }, { status: 500 });
  }
  if ((reportsToday ?? 0) >= MAX_REPORTS_PER_DAY) {
    return NextResponse.json(
      {
        error: `You can send ${MAX_REPORTS_PER_DAY} reports a day. Come back tomorrow.`,
        capped: true,
      },
      { status: 429 },
    );
  }

  // ── Insert (unique open report per user per set) ─────────────────────────
  const { error: insertErr } = await supabaseAdmin.from(LIBRARY_REPORTS_TABLE).insert({
    set_id: setId,
    reporter: userId,
    reason,
    status: "open",
  });
  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ ok: true, alreadyReported: true });
    }
    if (isMissingLibrarySchema(insertErr)) return libraryUnavailableResponse();
    console.error("[library/report] insert", insertErr.message);
    return NextResponse.json({ error: "Couldn't send the report." }, { status: 500 });
  }

  // ── Auto-unpublish at >= 3 unique open reporters (service role) ──────────
  const { data: openRows, error: openErr } = await supabaseAdmin
    .from(LIBRARY_REPORTS_TABLE)
    .select("reporter")
    .eq("set_id", setId)
    .eq("status", "open");
  if (openErr) {
    // The report itself stuck — the threshold check just runs again on the
    // next report. Non-fatal.
    console.error("[library/report] open count", openErr.message);
    return NextResponse.json({ ok: true, alreadyReported: false });
  }
  const uniqueReporters = new Set(
    ((openRows ?? []) as Array<{ reporter: string }>).map((r) => r.reporter),
  ).size;
  if (uniqueReporters >= REPORT_AUTO_UNPUBLISH_THRESHOLD) {
    const { error: pullErr } = await supabaseAdmin
      .from(STUDY_SETS_TABLE)
      .update({ is_public: false })
      .eq("id", setId);
    if (pullErr) {
      console.error("[library/report] auto-unpublish", pullErr.message);
    }
  }

  return NextResponse.json({ ok: true, alreadyReported: false });
}
