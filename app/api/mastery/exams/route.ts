import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { displayPct } from "@/lib/mastery";
import { PLAN_EXAM_LIMITS, type MasteryPlan } from "@/lib/mastery-plan";

/**
 * GET  /api/mastery/exams  — list the caller's exams (with progress summary)
 * POST /api/mastery/exams  — create a user_exam + its subtopics from a parse
 */

// ─────────────────────────────────────────────────────────────────────────────
// GET — list
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data: exams, error: examsErr } = await supabaseAdmin
      .from("user_exams")
      .select("id, title, topic_hash, scope, target_date, ready_threshold, mastery_bkt_target, total_active_seconds, reached_mastery_at, updated_at")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("updated_at", { ascending: false });

    if (examsErr) throw examsErr;
    if (!exams?.length) return NextResponse.json({ exams: [] });

    // Auto-archive stale targets:
    //   - Active (not yet mastered): hidden after 5 days of no activity
    //   - Mastered: hidden after 3 days (trophy posted, stop cluttering)
    // Filter server-side AND stamp `archived=true` so next fetch is fast.
    const now = Date.now();
    const FIVE_DAYS  = 5 * 24 * 60 * 60 * 1000;
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

    const toArchive: string[] = [];
    const live = exams.filter(e => {
      const masteryMs = e.reached_mastery_at ? new Date(e.reached_mastery_at).getTime() : null;
      const updatedMs = new Date(e.updated_at).getTime();
      const ageCeiling = masteryMs ? THREE_DAYS : FIVE_DAYS;
      const ageFrom = masteryMs ?? updatedMs;
      const stale = now - ageFrom > ageCeiling;
      if (stale) toArchive.push(e.id);
      return !stale;
    });
    if (toArchive.length) {
      // Fire-and-forget — next load stays snappy even if this write lags.
      void supabaseAdmin
        .from("user_exams")
        .update({ archived: true })
        .in("id", toArchive);
    }
    if (!live.length) return NextResponse.json({ exams: [] });

    const examIds = live.map(e => e.id);
    // Replace upstream binding so downstream logic sees only the live set.
    const filteredExams = live;

    // All subtopics + all progress for these exams in parallel
    const [subRes, progRes, sesRes] = await Promise.all([
      supabaseAdmin
        .from("mastery_subtopics")
        .select("id, user_exam_id, slug, name, weight, display_order, content_hash, short_summary")
        .in("user_exam_id", examIds)
        .order("display_order"),
      supabaseAdmin
        .from("mastery_progress")
        .select("subtopic_id, p_mastery, attempts, correct, display_pct, last_seen_at, total_active_seconds")
        .eq("user_id", userId),
      supabaseAdmin
        .from("mastery_sessions")
        .select("id, user_exam_id, status, last_active_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("last_active_at", { ascending: false }),
    ]);

    const subtopicsByExam = new Map<string, typeof subRes.data>();
    for (const s of subRes.data ?? []) {
      if (!subtopicsByExam.has(s.user_exam_id)) subtopicsByExam.set(s.user_exam_id, []);
      subtopicsByExam.get(s.user_exam_id)!.push(s);
    }

    const progressBySubtopic = new Map<string, NonNullable<typeof progRes.data>[number]>();
    for (const p of progRes.data ?? []) progressBySubtopic.set(p.subtopic_id, p);

    const activeSessionByExam = new Map<string, string>();
    for (const s of sesRes.data ?? []) {
      if (!activeSessionByExam.has(s.user_exam_id)) activeSessionByExam.set(s.user_exam_id, s.id);
    }

    const shaped = filteredExams.map(e => {
      const subs = subtopicsByExam.get(e.id) ?? [];
      let weightedPct = 0;
      let totalWeight = 0;
      for (const s of subs) {
        const p = progressBySubtopic.get(s.id);
        const pct = p ? displayPct(p.p_mastery, p.attempts, e.mastery_bkt_target) : 0;
        weightedPct += s.weight * pct;
        totalWeight += s.weight;
      }
      const overallPct = totalWeight > 0 ? weightedPct / totalWeight : 0;

      return {
        id: e.id,
        title: e.title,
        scope: e.scope,
        targetDate: e.target_date,
        readyThreshold: e.ready_threshold,
        totalActiveSeconds: e.total_active_seconds,
        reachedMasteryAt: e.reached_mastery_at,
        updatedAt: e.updated_at,
        overallDisplayPct: Math.round(overallPct * 10) / 10,
        subtopicCount: subs.length,
        activeSessionId: activeSessionByExam.get(e.id) ?? null,
      };
    });

    return NextResponse.json({ exams: shaped });
  } catch (e) {
    console.error("[mastery/exams GET]", e);
    return NextResponse.json({ error: "Couldn't load your mastery targets." }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — create from a parse result
// ─────────────────────────────────────────────────────────────────────────────
interface CreateBody {
  rawInput: string;
  title: string;
  topicHash: string;
  subtopics: {
    slug: string;
    name: string;
    weight: number;
    short_summary?: string;
    contentHash: string;
  }[];
  targetDate?: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: CreateBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // ── Validation ──────────────────────────────────────────────────────────
  const title = String(body.title ?? "").trim().slice(0, 120);
  const rawInput = String(body.rawInput ?? "").trim().slice(0, 8 * 1024);
  const topicHash = String(body.topicHash ?? "").trim();
  const subs = Array.isArray(body.subtopics) ? body.subtopics : [];

  if (title.length < 3) return NextResponse.json({ error: "Missing title" }, { status: 400 });
  if (!/^[a-f0-9]{40}$/.test(topicHash)) return NextResponse.json({ error: "Invalid topic hash" }, { status: 400 });
  if (subs.length < 3 || subs.length > 10) return NextResponse.json({ error: "Need 3–10 subtopics" }, { status: 400 });

  // Weights should sum to ~1.0 (accept small drift)
  const weightSum = subs.reduce((a, s) => a + Number(s.weight ?? 0), 0);
  if (weightSum < 0.9 || weightSum > 1.1) {
    return NextResponse.json({ error: "Subtopic weights must sum to ~1.0" }, { status: 400 });
  }

  // Parse target date if provided
  let targetDate: string | null = null;
  if (body.targetDate) {
    const d = new Date(body.targetDate);
    if (!isNaN(d.getTime())) targetDate = d.toISOString().slice(0, 10);
  }

  // ── Plan-based concurrent-exam limit ───────────────────────────────────
  //    Free plan keeps study focused; Pro/Platinum unlock wider study loads.
  //    Enforced on CREATE (not on resume), so existing over-cap users can
  //    still continue their old sessions; they just can't add new targets.
  const planLimit = await checkPlanLimit(userId);
  if (planLimit.overLimit) {
    return NextResponse.json(
      {
        error: "LIMIT",
        plan: planLimit.plan,
        limit: planLimit.limit,
        current: planLimit.current,
        message:
          `Your ${planLimit.plan} plan supports ${planLimit.limit} active mastery target${planLimit.limit === 1 ? "" : "s"}. ` +
          `You're at ${planLimit.current}. Archive an old target or upgrade to add more.`,
      },
      { status: 403 },
    );
  }

  try {
    const { data: exam, error: examErr } = await supabaseAdmin
      .from("user_exams")
      .insert({
        user_id: userId,
        raw_input: rawInput,
        title,
        topic_hash: topicHash,
        scope: "specific",
        target_date: targetDate,
      })
      .select("id")
      .single();

    if (examErr || !exam) {
      console.error("[mastery/exams POST] insert exam:", examErr?.message);
      return NextResponse.json({ error: "Couldn't save this target." }, { status: 500 });
    }

    const subRows = subs.map((s, i) => ({
      user_exam_id: exam.id,
      slug: String(s.slug ?? "").slice(0, 48).replace(/[^a-z0-9-]/g, "") || `topic-${i + 1}`,
      name: String(s.name ?? "").slice(0, 80),
      weight: Number(s.weight),
      display_order: i + 1,
      content_hash: String(s.contentHash ?? "").slice(0, 64),
      short_summary: String(s.short_summary ?? "").slice(0, 160) || null,
    }));

    const { error: subErr } = await supabaseAdmin.from("mastery_subtopics").insert(subRows);

    if (subErr) {
      // Clean up the exam row so we don't leave dangling exams without subtopics.
      await supabaseAdmin.from("user_exams").delete().eq("id", exam.id);
      console.error("[mastery/exams POST] insert subs:", subErr.message);
      return NextResponse.json({ error: "Couldn't save subtopics." }, { status: 500 });
    }

    return NextResponse.json({ examId: exam.id });
  } catch (e) {
    console.error("[mastery/exams POST]", e);
    return NextResponse.json({ error: "Couldn't save this target." }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan-based concurrent-exam enforcement. Limits imported from lib so the
// client-side paywall can reference the same values.
// ─────────────────────────────────────────────────────────────────────────────
async function checkPlanLimit(userId: string): Promise<{
  plan: MasteryPlan;
  limit: number;
  current: number;
  overLimit: boolean;
}> {
  // Default to 'free' if the plan column hasn't shipped (migration 032) or
  // the user hasn't been marked otherwise. Handles 42P01 gracefully.
  let plan: MasteryPlan = "free";
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .single();
    const p = String((data as { plan?: string } | null)?.plan ?? "free");
    if (p === "pro" || p === "platinum") plan = p;
  } catch {
    // fall through — plan stays 'free'
  }

  const limit = PLAN_EXAM_LIMITS[plan];

  // Count only non-archived targets. Archived (auto-aged or manually hidden)
  // doesn't count against the cap, matching user intuition.
  const { count } = await supabaseAdmin
    .from("user_exams")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("archived", false);

  const current = count ?? 0;
  return { plan, limit, current, overLimit: current >= limit };
}
