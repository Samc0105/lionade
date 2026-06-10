import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/academia/gpa — cross-class GPA roll-up for Academia.
 *
 * For each of the caller's non-archived classes we compute the SAME weighted
 * percent the per-class grades route shows (app/api/classes/[id]/grades):
 *
 *   currentWeightedPct = Σ (weight_i × pct_i) / Σ weight_i   over GRADED rows
 *
 * A row is "graded" exactly when the grades route considers it graded:
 *   earned_points is non-null AND max_points > 0  → pct = (earned/max) × 100.
 * Rows with no earned_points (or max_points <= 0) are ungraded and excluded.
 * When a class has zero graded rows its currentPct is null and it does not
 * contribute to the term GPA.
 *
 * Each class's percent maps to a standard US letter and 4.0-scale points.
 * termGpa is the unweighted mean of gpaPoints over the classes that have a
 * non-null currentPct, rounded to 2 decimals (null when none qualify).
 *
 * NOTE: classes have no credit-hours column today, so termGpa is UNWEIGHTED —
 * every graded class counts equally. Credit-weighting is a future enhancement
 * and would need a `classes.credits` column to weight each class's gpaPoints.
 *
 * supabaseAdmin (service role) bypasses RLS, so every query is filtered by
 * user_id and we never trust a userId from the request body.
 */

interface ClassRow {
  id: string;
  name: string;
  color: string;
}

interface GradeRow {
  class_id: string;
  earned_points: number | string | null;
  max_points: number | string;
  weight_pct: number | string;
}

interface ClassGpa {
  classId: string;
  className: string;
  classColor: string;
  currentPct: number | null;
  letter: string | null;
  gpaPoints: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grade math — kept identical to app/api/classes/[id]/grades/route.ts
// ─────────────────────────────────────────────────────────────────────────────

/** pct for a single row, mirroring shapeGrade(): null unless graded. */
function rowPct(r: GradeRow): number | null {
  const max = Number(r.max_points);
  const earnedRaw = r.earned_points;
  const earned = earnedRaw === null || earnedRaw === undefined ? null : Number(earnedRaw);
  return earned !== null && max > 0 ? (earned / max) * 100 : null;
}

/**
 * Weighted current grade over a class's rows, mirroring computeSummary():
 *   - only graded rows (pct !== null) count
 *   - normalize by their weight sum
 *   - if all graded rows have weight 0, fall back to a flat average
 *   - null when there are no graded rows
 */
function currentWeightedPct(rows: GradeRow[]): number | null {
  const graded = rows
    .map(r => ({ pct: rowPct(r), weight: Number(r.weight_pct) }))
    .filter((g): g is { pct: number; weight: number } => g.pct !== null);

  if (graded.length === 0) return null;

  const totalWeight = graded.reduce((acc, g) => acc + g.weight, 0);
  if (totalWeight > 0) {
    const weightedSum = graded.reduce((acc, g) => acc + g.weight * g.pct, 0);
    return Math.round((weightedSum / totalWeight) * 10) / 10;
  }
  // Edge case: every graded row has weight 0 — flat average so the user still
  // sees a number instead of an awkward null.
  const flat = graded.reduce((acc, g) => acc + g.pct, 0) / graded.length;
  return Math.round(flat * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard US letter + 4.0-scale mapping
// ─────────────────────────────────────────────────────────────────────────────

interface GradeBand {
  min: number;
  letter: string;
  points: number;
}

// Ordered high → low. First band whose `min` the pct meets wins.
const GRADE_BANDS: GradeBand[] = [
  { min: 93, letter: "A", points: 4.0 },
  { min: 90, letter: "A-", points: 3.7 },
  { min: 87, letter: "B+", points: 3.3 },
  { min: 83, letter: "B", points: 3.0 },
  { min: 80, letter: "B-", points: 2.7 },
  { min: 77, letter: "C+", points: 2.3 },
  { min: 73, letter: "C", points: 2.0 },
  { min: 70, letter: "C-", points: 1.7 },
  { min: 67, letter: "D+", points: 1.3 },
  { min: 63, letter: "D", points: 1.0 },
  { min: 60, letter: "D-", points: 0.7 },
  { min: 0, letter: "F", points: 0.0 },
];

function gradeFor(pct: number): { letter: string; points: number } {
  const band = GRADE_BANDS.find(b => pct >= b.min) ?? GRADE_BANDS[GRADE_BANDS.length - 1];
  return { letter: band.letter, points: band.points };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { data: classes, error: classesErr } = await supabaseAdmin
      .from("classes")
      .select("id, name, color")
      .eq("user_id", userId)
      .eq("archived", false);

    if (classesErr) throw classesErr;

    if (!classes?.length) {
      return NextResponse.json({
        termGpa: null,
        gradedClasses: 0,
        scale: "4.0",
        classes: [],
      });
    }

    const classIds = classes.map(c => c.id);

    const { data: gradeRows, error: gradesErr } = await supabaseAdmin
      .from("class_grades")
      .select("class_id, earned_points, max_points, weight_pct")
      .eq("user_id", userId)
      .in("class_id", classIds);

    if (gradesErr) throw gradesErr;

    // Group grade rows by class_id.
    const rowsByClass = new Map<string, GradeRow[]>();
    for (const r of (gradeRows ?? []) as GradeRow[]) {
      const list = rowsByClass.get(r.class_id) ?? [];
      list.push(r);
      rowsByClass.set(r.class_id, list);
    }

    const shaped: ClassGpa[] = (classes as ClassRow[]).map(c => {
      const pct = currentWeightedPct(rowsByClass.get(c.id) ?? []);
      if (pct === null) {
        return {
          classId: c.id,
          className: c.name,
          classColor: c.color,
          currentPct: null,
          letter: null,
          gpaPoints: null,
        };
      }
      const { letter, points } = gradeFor(pct);
      return {
        classId: c.id,
        className: c.name,
        classColor: c.color,
        currentPct: pct,
        letter,
        gpaPoints: points,
      };
    });

    // Term GPA: unweighted mean of gpaPoints over graded classes, 2 decimals.
    const graded = shaped.filter(
      (c): c is ClassGpa & { gpaPoints: number } => c.currentPct !== null && c.gpaPoints !== null,
    );
    const termGpa =
      graded.length > 0
        ? Math.round((graded.reduce((acc, c) => acc + c.gpaPoints, 0) / graded.length) * 100) / 100
        : null;

    // Sort: graded classes first (by name), then ungraded (by name).
    shaped.sort((a, b) => {
      const aGraded = a.currentPct !== null;
      const bGraded = b.currentPct !== null;
      if (aGraded !== bGraded) return aGraded ? -1 : 1;
      return a.className.localeCompare(b.className);
    });

    return NextResponse.json({
      termGpa,
      gradedClasses: graded.length,
      scale: "4.0",
      classes: shaped,
    });
  } catch (e) {
    console.error("[academia-gpa GET]", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "Couldn't load your GPA." }, { status: 500 });
  }
}
