import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/ninny/wrong-answers?materialId=X
// Returns the user's wrong-answer history for a specific material.
// Used by the page to weight question selection (spaced repetition) and
// to power the "Practice Your Misses" mode.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const materialId = req.nextUrl.searchParams.get("materialId");
  if (!materialId) {
    return NextResponse.json({ error: "Missing materialId" }, { status: 400 });
  }

  // Verify ownership before reading
  const { data: material } = await supabaseAdmin
    .from("ninny_materials")
    .select("id, user_id")
    .eq("id", materialId)
    .single();
  if (!material || material.user_id !== userId) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  const { data: rows, error } = await supabaseAdmin
    .from("ninny_wrong_answers")
    .select("question_text, correct_answer, miss_count")
    .eq("user_id", userId)
    .eq("material_id", materialId);

  if (error) {
    console.error("[ninny/wrong-answers GET]", error.message);
    return NextResponse.json({ wrongAnswers: [] });
  }

  return NextResponse.json({ wrongAnswers: rows ?? [] });
}
