import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET  /api/classes/[id]/grades  — list grade rows + computed summary
 * POST /api/classes/[id]/grades  — create a new grade row
 *
 * The `summary` block is computed from the rows on every GET so the client
 * never has to do the math. NUMERIC columns come back as strings via
 * supabase-js, so every numeric field is coerced through Number(...) before
 * arithmetic.
 *
 * Math (see also "needed on final" helper below):
 *   currentWeightedPct = Σ (weight_i × pct_i) / Σ weight_i  over GRADED rows
 *   neededOnFinal(target):
 *     Let earnedNonFinal = Σ (weight_i × pct_i) over graded NON-final rows
 *     Let weightNonFinal = Σ weight_i over graded NON-final rows  (denom of current)
 *     Let totalWeight    = weightNonFinal + finalWeight
 *     Solve: (earnedNonFinal + finalWeight × x) / totalWeight = target
 *     →     x = (target × totalWeight − earnedNonFinal) / finalWeight
 *   Returned as a plain percent (e.g. 92 means "you need 92%"). Capped at
 *   ≤ ~999 so a hopeless target collapses cleanly. >100 means unreachable.
 */

type RouteCtx = { params: { id: string } };

const VALID_CATEGORIES = ["Exam", "Quiz", "Homework", "Project", "Other"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

interface GradeRow {
  id: string;
  user_id: string;
  class_id: string;
  name: string;
  category: string | null;
  earned_points: number | string | null;
  max_points: number | string;
  weight_pct: number | string;
  is_final: boolean;
  due_date: string | null;
  graded_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ShapedGrade {
  id: string;
  name: string;
  category: string | null;
  earnedPoints: number | null;
  maxPoints: number;
  weightPct: number;
  isFinal: boolean;
  dueDate: string | null;
  gradedAt: string | null;
  pct: number | null;          // earned/max as a percent, when graded
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function shapeGrade(r: GradeRow): ShapedGrade {
  const max = Number(r.max_points);
  const earnedRaw = r.earned_points;
  const earned = earnedRaw === null || earnedRaw === undefined ? null : Number(earnedRaw);
  const pct = earned !== null && max > 0 ? (earned / max) * 100 : null;
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    earnedPoints: earned,
    maxPoints: max,
    weightPct: Number(r.weight_pct),
    isFinal: r.is_final,
    dueDate: r.due_date,
    gradedAt: r.graded_at,
    pct: pct === null ? null : Math.round(pct * 10) / 10,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface Summary {
  currentWeightedPct: number | null;
  gradedCount: number;
  ungradedCount: number;
  finalRow: { id: string; name: string; weightPct: number } | null;
  neededOnFinalForA: number | null;
  neededOnFinalForB: number | null;
}

/**
 * Solve for the percentage needed on `finalRow` to land at `targetPct` overall.
 * Returns:
 *   - null if there is no final row
 *   - a number (can be negative or > 100). Caller decides how to render it.
 */
function neededOnFinal(
  graded: ShapedGrade[],
  finalRow: ShapedGrade | null,
  targetPct: number,
): number | null {
  if (!finalRow) return null;
  const finalWeight = finalRow.weightPct;
  if (finalWeight <= 0) return null;

  // Earned weight on every graded NON-final row.
  const nonFinalGraded = graded.filter(g => !g.isFinal && g.pct !== null);
  const earnedNonFinal = nonFinalGraded.reduce(
    (acc, g) => acc + g.weightPct * (g.pct as number),
    0,
  );
  const weightNonFinal = nonFinalGraded.reduce((acc, g) => acc + g.weightPct, 0);
  const totalWeight = weightNonFinal + finalWeight;
  if (totalWeight <= 0) return null;

  // (earnedNonFinal + finalWeight * x) / totalWeight = targetPct
  const x = (targetPct * totalWeight - earnedNonFinal) / finalWeight;
  return Math.round(x * 10) / 10;
}

function computeSummary(grades: ShapedGrade[]): Summary {
  const graded = grades.filter(g => g.pct !== null);
  const ungraded = grades.filter(g => g.pct === null);

  // Weighted current grade — only over graded rows, normalized by their weight
  // sum. NOT cumulative — a half-finished syllabus still gets a sensible %.
  const totalGradedWeight = graded.reduce((acc, g) => acc + g.weightPct, 0);
  let currentWeightedPct: number | null = null;
  if (graded.length > 0) {
    if (totalGradedWeight > 0) {
      const weightedSum = graded.reduce(
        (acc, g) => acc + g.weightPct * (g.pct as number),
        0,
      );
      currentWeightedPct = Math.round((weightedSum / totalGradedWeight) * 10) / 10;
    } else {
      // Edge case: rows have weight 0. Fall back to a flat average so the
      // user still sees a number instead of an awkward null.
      const flat = graded.reduce((acc, g) => acc + (g.pct as number), 0) / graded.length;
      currentWeightedPct = Math.round(flat * 10) / 10;
    }
  }

  const finalRow = grades.find(g => g.isFinal) ?? null;
  return {
    currentWeightedPct,
    gradedCount: graded.length,
    ungradedCount: ungraded.length,
    finalRow: finalRow
      ? { id: finalRow.id, name: finalRow.name, weightPct: finalRow.weightPct }
      : null,
    neededOnFinalForA: neededOnFinal(graded, finalRow, 90),
    neededOnFinalForB: neededOnFinal(graded, finalRow, 80),
  };
}

async function verifyClassOwnership(classId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("classes")
    .select("user_id, archived")
    .eq("id", classId)
    .single();
  return !!data && data.user_id === userId && !data.archived;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — list + summary
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  if (!(await verifyClassOwnership(classId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("class_grades")
    .select(
      "id, user_id, class_id, name, category, earned_points, max_points, weight_pct, is_final, due_date, graded_at, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("class_id", classId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[class-grades GET]", error.message);
    return NextResponse.json({ error: "Couldn't load grades." }, { status: 500 });
  }

  const grades = (data ?? []).map(shapeGrade);
  const summary = computeSummary(grades);

  return NextResponse.json({ grades, summary });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — create
// ─────────────────────────────────────────────────────────────────────────────
interface CreateBody {
  name?: string;
  category?: string | null;
  earned_points?: number | string | null;
  max_points?: number | string;
  weight_pct?: number | string;
  is_final?: boolean;
  due_date?: string | null;
  graded_at?: string | null;
}

function parseNumber(v: unknown, field: string): number | NextResponse {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: `${field} must be a number.` }, { status: 400 });
  }
  return n;
}

function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  // YYYY-MM-DD only — anything else gets rejected as null. Keeps DATE clean.
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;

  let body: CreateBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!(await verifyClassOwnership(classId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── Validate & coerce ────────────────────────────────────────────────────
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (name.length < 1) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const category =
    body.category && VALID_CATEGORIES.includes(body.category as Category)
      ? (body.category as Category)
      : null;

  const maxRaw = parseNumber(body.max_points, "max_points");
  if (maxRaw instanceof NextResponse) return maxRaw;
  if (maxRaw <= 0) {
    return NextResponse.json({ error: "max_points must be greater than 0." }, { status: 400 });
  }

  const weightRaw = parseNumber(body.weight_pct ?? 0, "weight_pct");
  if (weightRaw instanceof NextResponse) return weightRaw;
  if (weightRaw < 0 || weightRaw > 100) {
    return NextResponse.json({ error: "weight_pct must be between 0 and 100." }, { status: 400 });
  }

  let earned: number | null = null;
  if (body.earned_points !== null && body.earned_points !== undefined && body.earned_points !== "") {
    const e = parseNumber(body.earned_points, "earned_points");
    if (e instanceof NextResponse) return e;
    if (e < 0 || e > maxRaw) {
      return NextResponse.json(
        { error: "earned_points must be between 0 and max_points." },
        { status: 400 },
      );
    }
    earned = e;
  }

  const isFinal = !!body.is_final;
  const dueDate = parseDate(body.due_date);
  const gradedAt = parseDate(body.graded_at);

  const { data, error } = await supabaseAdmin
    .from("class_grades")
    .insert({
      user_id: userId,
      class_id: classId,
      name,
      category,
      earned_points: earned,
      max_points: maxRaw,
      weight_pct: weightRaw,
      is_final: isFinal,
      due_date: dueDate,
      graded_at: gradedAt,
    })
    .select(
      "id, user_id, class_id, name, category, earned_points, max_points, weight_pct, is_final, due_date, graded_at, created_at, updated_at",
    )
    .single();

  if (error || !data) {
    console.error("[class-grades POST]", error?.message);
    return NextResponse.json({ error: "Couldn't save grade." }, { status: 500 });
  }

  return NextResponse.json({ grade: shapeGrade(data) }, { status: 201 });
}
