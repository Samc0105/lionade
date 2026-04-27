import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * PATCH  /api/classes/[id]/grades/[gradeId]  — partial update of a grade row
 * DELETE /api/classes/[id]/grades/[gradeId]  — hard delete (no soft delete)
 *
 * Ownership check is on the grade row's user_id + class_id (so a forged URL
 * with a valid gradeId from a different class returns 404). NUMERIC values
 * coerce through Number(...) on the way in.
 */

type RouteCtx = { params: { id: string; gradeId: string } };

const VALID_CATEGORIES = ["Exam", "Quiz", "Homework", "Project", "Other"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

interface PatchBody {
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
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;
  const gradeId = params.gradeId;

  let body: PatchBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Verify ownership of the grade *and* it belongs to the URL's class.
  const { data: existing } = await supabaseAdmin
    .from("class_grades")
    .select("id, user_id, class_id, max_points")
    .eq("id", gradeId)
    .single();

  if (!existing || existing.user_id !== userId || existing.class_id !== classId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80);
    if (name.length < 1) {
      return NextResponse.json({ error: "Name can't be empty." }, { status: 400 });
    }
    update.name = name;
  }

  if (body.category !== undefined) {
    update.category =
      body.category && VALID_CATEGORIES.includes(body.category as Category)
        ? (body.category as Category)
        : null;
  }

  // We need the post-update max_points to validate earned_points, since both
  // can change in the same call.
  let nextMax = Number(existing.max_points);
  if (body.max_points !== undefined) {
    const m = parseNumber(body.max_points, "max_points");
    if (m instanceof NextResponse) return m;
    if (m <= 0) {
      return NextResponse.json({ error: "max_points must be greater than 0." }, { status: 400 });
    }
    update.max_points = m;
    nextMax = m;
  }

  if (body.weight_pct !== undefined) {
    const w = parseNumber(body.weight_pct, "weight_pct");
    if (w instanceof NextResponse) return w;
    if (w < 0 || w > 100) {
      return NextResponse.json({ error: "weight_pct must be between 0 and 100." }, { status: 400 });
    }
    update.weight_pct = w;
  }

  if (body.earned_points !== undefined) {
    if (body.earned_points === null || body.earned_points === "") {
      update.earned_points = null;
    } else {
      const e = parseNumber(body.earned_points, "earned_points");
      if (e instanceof NextResponse) return e;
      if (e < 0 || e > nextMax) {
        return NextResponse.json(
          { error: "earned_points must be between 0 and max_points." },
          { status: 400 },
        );
      }
      update.earned_points = e;
    }
  }

  if (body.is_final !== undefined) update.is_final = !!body.is_final;
  if (body.due_date !== undefined) update.due_date = parseDate(body.due_date);
  if (body.graded_at !== undefined) update.graded_at = parseDate(body.graded_at);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const { data, error } = await supabaseAdmin
    .from("class_grades")
    .update(update)
    .eq("id", gradeId)
    .eq("user_id", userId)
    .select(
      "id, user_id, class_id, name, category, earned_points, max_points, weight_pct, is_final, due_date, graded_at, created_at, updated_at",
    )
    .single();

  if (error || !data) {
    console.error("[class-grades PATCH]", error?.message);
    return NextResponse.json({ error: "Couldn't update grade." }, { status: 500 });
  }

  // Shape inline (don't import the helper across files for one row).
  const max = Number(data.max_points);
  const earned = data.earned_points === null ? null : Number(data.earned_points);
  return NextResponse.json({
    grade: {
      id: data.id,
      name: data.name,
      category: data.category,
      earnedPoints: earned,
      maxPoints: max,
      weightPct: Number(data.weight_pct),
      isFinal: data.is_final,
      dueDate: data.due_date,
      gradedAt: data.graded_at,
      pct: earned !== null && max > 0 ? Math.round((earned / max) * 1000) / 10 : null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — hard delete after ownership check
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const classId = params.id;
  const gradeId = params.gradeId;

  // Ownership + class-match in one query.
  const { data: existing } = await supabaseAdmin
    .from("class_grades")
    .select("id, user_id, class_id")
    .eq("id", gradeId)
    .single();

  if (!existing || existing.user_id !== userId || existing.class_id !== classId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from("class_grades")
    .delete()
    .eq("id", gradeId)
    .eq("user_id", userId);

  if (error) {
    console.error("[class-grades DELETE]", error.message);
    return NextResponse.json({ error: "Couldn't delete grade." }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
