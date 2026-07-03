import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isMissingSchema } from "@/lib/db/missing-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET   /api/admin/library-reports          — open report queue (set + reporter context)
 * PATCH /api/admin/library-reports          — { id, action: "dismiss" | "uphold" }
 *
 * The admin half of the library report flow (the report route auto-unpublishes
 * a set at >= 3 unique open reporters and the publish route blocks republish
 * while those reports stay OPEN). Without this queue a takedown would be
 * permanent, which turns 3 sock accounts into a censorship tool - dismissing
 * the reports here clears the republish block; upholding records the decision.
 *
 * Guard: requireRole "support" for GET (read/triage), "admin" for PATCH
 * (a resolution changes what a creator can publish - destructive-adjacent).
 * Fail-soft: library_reports lives in the HELD addendum migration; a missing
 * table returns an empty queue, never a 500.
 */

export async function GET(req: NextRequest) {
  const staff = await requireRole(req, "support");
  if (staff instanceof NextResponse) return staff;

  const { data: reports, error } = await supabaseAdmin
    .from("library_reports")
    .select("id, set_id, reporter, reason, status, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json({ reports: [], notReady: true });
    }
    console.error("[admin/library-reports GET]", error.message);
    return NextResponse.json({ error: "Couldn't load reports." }, { status: 500 });
  }

  // Hydrate set titles + owners for triage context (best-effort).
  const setIds = Array.from(new Set((reports ?? []).map((r) => r.set_id)));
  const setMap = new Map<string, { title: string; user_id: string; is_public: boolean }>();
  if (setIds.length > 0) {
    const { data: sets } = await supabaseAdmin
      .from("study_sets")
      .select("id, title, user_id, is_public")
      .in("id", setIds);
    for (const s of sets ?? []) {
      setMap.set(s.id as string, {
        title: s.title as string,
        user_id: s.user_id as string,
        is_public: Boolean(s.is_public),
      });
    }
  }

  return NextResponse.json({
    reports: (reports ?? []).map((r) => ({
      ...r,
      set: setMap.get(r.set_id as string) ?? null,
    })),
  });
}

interface PatchBody {
  id?: unknown;
  action?: unknown;
}

export async function PATCH(req: NextRequest) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : null;
  const action = body.action === "dismiss" || body.action === "uphold" ? body.action : null;
  if (!id || !action) {
    return NextResponse.json(
      { error: "Provide a report id and an action (dismiss or uphold)." },
      { status: 400 },
    );
  }

  const nextStatus = action === "dismiss" ? "dismissed" : "upheld";
  const { data: updated, error } = await supabaseAdmin
    .from("library_reports")
    .update({ status: nextStatus })
    .eq("id", id)
    .eq("status", "open")
    .select("id, set_id")
    .maybeSingle();

  if (error) {
    if (isMissingSchema(error)) {
      return NextResponse.json(
        { error: "Reports aren't set up yet.", notReady: true },
        { status: 503 },
      );
    }
    console.error("[admin/library-reports PATCH]", error.message);
    return NextResponse.json({ error: "Couldn't update the report." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Report not found or already resolved." }, { status: 404 });
  }

  // Dismissing may clear the republish block; nothing else to do server-side
  // (the publish route re-checks open-report counts live). Upholding keeps
  // the set unpublished by leaving the report on the record as upheld -
  // publish's block counts OPEN reports only, so an upheld takedown that
  // should stay down relies on the admin ALSO leaving is_public false, which
  // auto-unpublish already did.
  return NextResponse.json({ ok: true, id: updated.id, status: nextStatus });
}
