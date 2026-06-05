import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_CONFIDENCE = ["confident", "shaky", "struggling"] as const;
type SelfConfidence = (typeof ALLOWED_CONFIDENCE)[number] | null;

function isValidConfidence(v: unknown): v is SelfConfidence {
  return v === null || (typeof v === "string" && ALLOWED_CONFIDENCE.includes(v as typeof ALLOWED_CONFIDENCE[number]));
}

/**
 * PATCH /api/vocab/words/[id] — update self_confidence for a vocab word.
 *
 * Body: { self_confidence: 'confident' | 'shaky' | 'struggling' | null }
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;

  if (!("self_confidence" in raw)) {
    return NextResponse.json({ error: "self_confidence is required" }, { status: 400 });
  }

  const selfConfidence = raw.self_confidence;
  if (!isValidConfidence(selfConfidence)) {
    return NextResponse.json(
      { error: "self_confidence must be 'confident', 'shaky', 'struggling', or null" },
      { status: 400 },
    );
  }

  const { error, count } = await supabaseAdmin
    .from("vocab_words")
    .update({ self_confidence: selfConfidence }, { count: "exact" })
    .eq("id", params.id)
    .eq("user_id", userId);

  if (error) {
    console.error("[vocab/words PATCH] error:", error.message);
    return NextResponse.json({ error: "Failed to update word" }, { status: 500 });
  }

  if (!count) {
    return NextResponse.json({ error: "Word not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, self_confidence: selfConfidence });
}

/**
 * DELETE /api/vocab/words/[id] — remove a vocab word.
 *
 * Soft-delete is queued for V2 per the schema migration's footer. V1 hard-
 * deletes the row; the user-id WHERE clause means the call no-ops if the
 * caller doesn't own the row (no 404 leak).
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { error, count } = await supabaseAdmin
    .from("vocab_words")
    .delete({ count: "exact" })
    .eq("id", params.id)
    .eq("user_id", userId);

  if (error) {
    console.error("[vocab/words DELETE] error:", error.message);
    return NextResponse.json({ error: "Failed to delete word" }, { status: 500 });
  }

  if (!count) {
    return NextResponse.json({ error: "Word not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
