// POST /api/party/sketch/rounds/[id]/advance-phase
//
// Transitions a sketch round's `phase` column from "celebrating" -> "reveal".
// Called by the frontend ~2.5s after the celebrating overlay shows so the
// persisted phase matches what users see. Idempotent — re-firing on a row
// already in "reveal" is a no-op.
//
// Server-side guard: refuses to advance before
//   celebrating_started_at + MIN_CELEBRATING_MS
// so a malicious client can't skip the overlay for everyone else.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isRoomMember } from "@/lib/party/room-state";

// Matches the client overlay hold (CELEBRATING_HOLD_MS in SketchView).
const MIN_CELEBRATING_MS = 2_500;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select("id, room_id, phase, celebrating_started_at")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) {
    return NextResponse.json({ error: "Round not found" }, { status: 404 });
  }

  // Only an authenticated room member can advance the phase.
  if (!(await isRoomMember(supabaseAdmin, round.room_id, userId))) {
    return NextResponse.json({ error: "Not a room member" }, { status: 403 });
  }

  // Already past the celebrating window — return current state.
  if (round.phase === "reveal") {
    return NextResponse.json({ ok: true, phase: "reveal", already: true });
  }
  if (round.phase !== "celebrating") {
    return NextResponse.json({ ok: true, phase: round.phase ?? null });
  }

  if (round.celebrating_started_at) {
    const elapsed = Date.now() - new Date(round.celebrating_started_at).getTime();
    if (elapsed < MIN_CELEBRATING_MS) {
      return NextResponse.json(
        { error: "Celebrating window not yet elapsed", remainingMs: MIN_CELEBRATING_MS - elapsed },
        { status: 409 },
      );
    }
  }

  // Optimistic transition guard — only flip if still in 'celebrating'. Two
  // racing clients hitting this route at once both see one row updated.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("sketch_rounds")
    .update({ phase: "reveal" })
    .eq("id", round.id)
    .eq("phase", "celebrating")
    .select("phase")
    .maybeSingle();
  if (updErr) {
    console.error("[sketch/rounds/:id/advance-phase]", updErr.message);
    return NextResponse.json({ error: "Couldn't advance phase." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, phase: updated?.phase ?? round.phase });
}
