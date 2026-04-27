import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET  /api/academia/onboarding  — status snapshot (gated? what's filled?)
 * POST /api/academia/onboarding  — submit answers, mark academia_onboarded_at
 *
 * Used by the /academia gate: if `onboarded === false`, the page redirects
 * the user to `/academia/onboarding`. The onboarding form re-uses GET so
 * a back-button click into the form pre-fills any partial draft (we save
 * partial state on the client anyway, but a server snapshot is the source
 * of truth on a fresh device).
 */

const SCHOOL_TYPES = ["middle", "high", "college", "grad", "professional", "self_study", "other"] as const;
const INTENSITIES  = ["chill", "steady", "grinding", "cramming"] as const;
type SchoolType = typeof SCHOOL_TYPES[number];
type Intensity  = typeof INTENSITIES[number];

interface SubmitBody {
  schoolType: SchoolType;
  gradeYear?: string | null;
  classCount: number;
  schoolName?: string | null;
  field?: string | null;
  studyIntensity: Intensity;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — status
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("academia_school_type, academia_grade_year, academia_class_count, academia_school_name, academia_field, academia_study_intensity, academia_onboarded_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[academia/onboarding GET]", error.message);
    return NextResponse.json({ error: "Couldn't load status." }, { status: 500 });
  }

  return NextResponse.json({
    onboarded: !!data?.academia_onboarded_at,
    answers: data ? {
      schoolType: data.academia_school_type,
      gradeYear: data.academia_grade_year,
      classCount: data.academia_class_count,
      schoolName: data.academia_school_name,
      field: data.academia_field,
      studyIntensity: data.academia_study_intensity,
    } : null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — submit
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: SubmitBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!SCHOOL_TYPES.includes(body.schoolType)) {
    return NextResponse.json({ error: "Pick a school type." }, { status: 400 });
  }
  if (!INTENSITIES.includes(body.studyIntensity)) {
    return NextResponse.json({ error: "Pick a study intensity." }, { status: 400 });
  }
  const classCount = Number.isFinite(body.classCount) ? Math.floor(body.classCount) : -1;
  if (classCount < 0 || classCount > 30) {
    return NextResponse.json({ error: "Class count must be 0–30." }, { status: 400 });
  }

  const trim = (v: string | null | undefined, max: number) =>
    v ? String(v).trim().slice(0, max) || null : null;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      academia_school_type: body.schoolType,
      academia_grade_year: trim(body.gradeYear, 40),
      academia_class_count: classCount,
      academia_school_name: trim(body.schoolName, 80),
      academia_field: trim(body.field, 80),
      academia_study_intensity: body.studyIntensity,
      academia_onboarded_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error("[academia/onboarding POST]", error.message);
    return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
