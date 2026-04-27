import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { displayPct } from "@/lib/mastery";

/**
 * GET /api/study-dna
 *
 * Returns a snapshot of the user's study identity — strengths,
 * weaknesses, recent activity, lifetime stats — assembled from data
 * we already have:
 *
 *   - profiles                 → streak, level, xp, lifetime fangs
 *   - quiz_history (if exists) → subject coverage, accuracy by subject
 *   - mastery_progress         → per-subtopic mastery
 *   - mastery_subtopics        → subtopic names + their parent exam/class
 *   - user_exams + classes     → exam/class context for the subtopics
 *   - mastery_events           → daily activity heatmap (30 days)
 *   - daily_drill_completions  → drill perfection ratio
 *   - coin_transactions        → activity inference + lifetime fangs earned
 *
 * Output shape is heavyweight by design — the /study-dna page is a
 * single dashboard that needs everything in one round-trip.
 */

interface SubjectStat {
  /** Display name (subject name OR class name OR "Other") */
  name: string;
  /** 0..100 */
  masteryPct: number;
  attempts: number;
  correct: number;
  /** subtopicId or class id this row aggregates */
  key: string;
  /** "subtopic" | "class" | "subject" */
  source: "subtopic" | "class" | "subject";
}

interface DnaResponse {
  identity: {
    title: string;       // computed nickname like "AWS Crusher" / "Methodical Master"
    blurb: string;
    streak: number;
    bestStreak: number;
    level: number;
    xp: number;
    lifetimeFangs: number;
  };
  totals: {
    questionsAnswered: number;     // mastery + drill answers
    correct: number;
    accuracy: number;              // 0..1
    classesCount: number;
    examTargetsCount: number;
    notesCount: number;
    drillCompletions: number;
    drillPerfectRuns: number;
    focusSessionsCompleted: number;
  };
  strengths: SubjectStat[];        // top 5 by mastery
  weaknesses: SubjectStat[];       // bottom 5 by mastery
  /** Last 30 days, oldest → newest. value = activity points (answered question OR drill). */
  heatmap: Array<{ date: string; value: number }>;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const thirtyDaysAgoIso = new Date(today.getTime() - 29 * 86_400_000).toISOString();

    // ── Fan out: profile, mastery, drills, focus, classes, notes, events,
    //    plus old quiz_history if present (catch errors so missing tables
    //    don't blow up the whole response).
    const [
      profileRes,
      progressRes,
      subtopicsRes,
      examsRes,
      classesRes,
      notesRes,
      eventsRes,
      drillRes,
      focusRes,
      lifetimeFangsRes,
    ] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("streak, max_streak, level, xp")
        .eq("id", userId)
        .single(),
      supabaseAdmin
        .from("mastery_progress")
        .select("subtopic_id, p_mastery, attempts, correct")
        .eq("user_id", userId),
      supabaseAdmin
        .from("mastery_subtopics")
        .select("id, name, user_exam_id, weight"),
      supabaseAdmin
        .from("user_exams")
        .select("id, title, class_id, mastery_bkt_target")
        .eq("user_id", userId)
        .eq("archived", false),
      supabaseAdmin
        .from("classes")
        .select("id, name, color, emoji")
        .eq("user_id", userId)
        .eq("archived", false),
      supabaseAdmin
        .from("class_notes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("archived", false),
      supabaseAdmin
        .from("mastery_events")
        .select("event_type, was_correct, created_at")
        .eq("user_id", userId)
        .gte("created_at", thirtyDaysAgoIso)
        .limit(2000),
      supabaseAdmin
        .from("daily_drill_completions")
        .select("id, score, total"),
      supabaseAdmin
        .from("coin_transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("type", "focus_session"),
      supabaseAdmin
        .from("coin_transactions")
        .select("amount")
        .eq("user_id", userId)
        .gt("amount", 0),
    ]);

    const profile = profileRes.data ?? { streak: 0, max_streak: 0, level: 1, xp: 0 };

    // Filter mastery progress + subtopics down to the user's exams.
    const userExamIds = new Set((examsRes.data ?? []).map(e => e.id));
    const myExams = examsRes.data ?? [];
    const examById = new Map(myExams.map(e => [e.id, e]));
    const classById = new Map((classesRes.data ?? []).map(c => [c.id, c]));

    const mySubtopics = (subtopicsRes.data ?? []).filter(s => userExamIds.has(s.user_exam_id));
    const subtopicById = new Map(mySubtopics.map(s => [s.id, s]));

    const myProgress = (progressRes.data ?? []).filter(p => subtopicById.has(p.subtopic_id));

    // Build per-subtopic stats with class/exam context.
    const subtopicStats: SubjectStat[] = myProgress.map(p => {
      const sub = subtopicById.get(p.subtopic_id)!;
      const exam = examById.get(sub.user_exam_id);
      const cls = exam?.class_id ? classById.get(exam.class_id) : null;
      const target = exam?.mastery_bkt_target ?? 0.95;
      const pct = displayPct(p.p_mastery, p.attempts, target);
      // Display name: prefer "Class · Subtopic" for context
      const name = cls ? `${cls.name} · ${sub.name}` : sub.name;
      return {
        name,
        masteryPct: pct,
        attempts: p.attempts ?? 0,
        correct: p.correct ?? 0,
        key: p.subtopic_id,
        source: "subtopic",
      };
    });

    // Strengths (top 5 by mastery, tiebreaker by attempts) +
    // weaknesses (bottom 5 with at least 3 attempts so we don't list
    // brand-new untouched subtopics as "weak").
    const strengths = [...subtopicStats]
      .filter(s => s.attempts >= 1)
      .sort((a, b) => b.masteryPct - a.masteryPct || b.attempts - a.attempts)
      .slice(0, 5);
    const weaknesses = [...subtopicStats]
      .filter(s => s.attempts >= 3)
      .sort((a, b) => a.masteryPct - b.masteryPct || b.attempts - a.attempts)
      .slice(0, 5);

    // Totals
    const masteryAttempts = myProgress.reduce((a, p) => a + (p.attempts ?? 0), 0);
    const masteryCorrect = myProgress.reduce((a, p) => a + (p.correct ?? 0), 0);
    const drillStats = (drillRes.data ?? []) as Array<{ score: number; total: number }>;
    const drillCompletions = drillStats.length;
    const drillPerfect = drillStats.filter(d => d.score === d.total && d.total >= 3).length;
    const drillTotal = drillStats.reduce((a, d) => a + d.total, 0);
    const drillCorrect = drillStats.reduce((a, d) => a + d.score, 0);

    const totalAnswered = masteryAttempts + drillTotal;
    const totalCorrect = masteryCorrect + drillCorrect;
    const accuracy = totalAnswered > 0 ? totalCorrect / totalAnswered : 0;

    const lifetimeFangs = (lifetimeFangsRes.data ?? []).reduce(
      (a: number, t: { amount: number }) => a + (t.amount ?? 0),
      0,
    );

    // ── Heatmap — bucket events by UTC date (30 days)
    const buckets = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today.getTime() - (29 - i) * 86_400_000);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const ev of eventsRes.data ?? []) {
      if (!["answer", "teach_served"].includes(String(ev.event_type))) continue;
      const date = (ev.created_at as string).slice(0, 10);
      if (buckets.has(date)) {
        buckets.set(date, (buckets.get(date) ?? 0) + 1);
      }
    }
    const heatmap = Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));

    // ── Identity title heuristic
    const identity = computeIdentity({
      streak: profile.streak ?? 0,
      bestStreak: profile.max_streak ?? 0,
      accuracy,
      totalAnswered,
      strengths,
      weaknesses,
      drillPerfectRuns: drillPerfect,
      level: profile.level ?? 1,
    });

    const out: DnaResponse = {
      identity: {
        ...identity,
        streak: profile.streak ?? 0,
        bestStreak: profile.max_streak ?? 0,
        level: profile.level ?? 1,
        xp: profile.xp ?? 0,
        lifetimeFangs,
      },
      totals: {
        questionsAnswered: totalAnswered,
        correct: totalCorrect,
        accuracy,
        classesCount: classesRes.data?.length ?? 0,
        examTargetsCount: examsRes.data?.length ?? 0,
        notesCount: notesRes.count ?? 0,
        drillCompletions,
        drillPerfectRuns: drillPerfect,
        focusSessionsCompleted: focusRes.count ?? 0,
      },
      strengths,
      weaknesses,
      heatmap,
    };

    return NextResponse.json(out);
  } catch (e) {
    console.error("[study-dna]", e);
    return NextResponse.json({ error: "Couldn't build your DNA right now." }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity heuristic — small rules engine that picks a flattering title.
// ─────────────────────────────────────────────────────────────────────────────
function computeIdentity(args: {
  streak: number;
  bestStreak: number;
  accuracy: number;
  totalAnswered: number;
  strengths: SubjectStat[];
  weaknesses: SubjectStat[];
  drillPerfectRuns: number;
  level: number;
}): { title: string; blurb: string } {
  const { streak, bestStreak, accuracy, totalAnswered, strengths, drillPerfectRuns } = args;

  // Brand-new account
  if (totalAnswered < 5) {
    return {
      title: "FRESH RECRUIT",
      blurb: "Your study DNA is still loading. Answer some questions to unlock the rest.",
    };
  }

  // Streak king
  if (streak >= 14 || bestStreak >= 30) {
    return {
      title: "CONSISTENCY KING",
      blurb: `${streak} day streak. Showing up is half the game and you're winning it.`,
    };
  }

  // Perfectionist
  if (accuracy >= 0.85 && totalAnswered >= 30) {
    return {
      title: "METHODICAL MASTER",
      blurb: `${Math.round(accuracy * 100)}% accuracy across ${totalAnswered} questions. You don't guess, you know.`,
    };
  }

  // Drill specialist
  if (drillPerfectRuns >= 3) {
    return {
      title: "DRILL SPECIALIST",
      blurb: `${drillPerfectRuns} perfect daily drills. Your weak spots don't stay weak for long.`,
    };
  }

  // Volume grinder
  if (totalAnswered >= 100) {
    return {
      title: "VOLUME GRINDER",
      blurb: `${totalAnswered} questions answered. The rep makes the master.`,
    };
  }

  // Subject specialist
  const top = strengths[0];
  if (top && top.masteryPct >= 70) {
    const niceName = top.name.split("·").pop()?.trim() || top.name;
    return {
      title: `${niceName.toUpperCase()} CRUSHER`,
      blurb: `${Math.round(top.masteryPct)}% mastery in ${niceName}. You've got a clear strength.`,
    };
  }

  // Default — balanced explorer
  return {
    title: "BALANCED EXPLORER",
    blurb: "You're spreading effort across topics. Lock in on a weak spot to climb fast.",
  };
}
