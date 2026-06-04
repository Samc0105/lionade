/**
 * GET /api/coach/resume/sessions/[id]/export
 *
 * Renders the user's accepted/improved bullets as markdown and returns
 * it as a download. We DO NOT generate a full PDF resume — that's V2.
 * The user pastes these into their existing resume.
 *
 * For each question that has at least one /answer turn, we surface the
 * MOST RECENT improved_bullet (last entry in analysis_json.answers[]
 * with that question_index). Questions that haven't been answered yet
 * are skipped — empty bullets aren't useful in the export.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteCtx = { params: { id: string } };

interface AnalysisJson {
  questions: { bullet: string; ask: string }[];
  answers: {
    question_index: number;
    user_response: string;
    improved_bullet: string;
    created_at: string;
  }[];
}

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const id = params.id;

  const { data, error } = await supabaseAdmin
    .from("resume_coach_sessions")
    .select("id, analysis_json")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const analysis = (data as { analysis_json: AnalysisJson }).analysis_json;
  const questions = Array.isArray(analysis?.questions) ? analysis.questions : [];
  const answers = Array.isArray(analysis?.answers) ? analysis.answers : [];

  // Map question_index → latest improved_bullet
  const latestByIndex = new Map<number, string>();
  for (const a of answers) {
    if (a && typeof a.question_index === "number" && typeof a.improved_bullet === "string") {
      latestByIndex.set(a.question_index, a.improved_bullet);
    }
  }

  const lines: string[] = ["# Your improved resume bullets", ""];
  let pairCount = 0;
  questions.forEach((q, i) => {
    const improved = latestByIndex.get(i);
    if (!improved) return;
    lines.push(`Original: ${q.bullet}`);
    lines.push(`Improved: ${improved}`);
    lines.push("");
    pairCount++;
  });

  if (pairCount === 0) {
    lines.push(
      "_No bullets rewritten yet. Answer at least one Socratic question to populate this export._",
    );
  }

  const md = lines.join("\n");
  const filename = `resume-coach-bullets-${id.slice(0, 8)}.md`;

  return new NextResponse(md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
