// POST /api/party/sketch/rounds/[id]/strokes — persist a batch of strokes.
//
// Body: { strokes: SketchStrokePayload[] }
//   Each: { stroke_num, color, size, points: number[][] }
//
// Drawer-only. We persist for late-joiner replay; the live stream goes via
// Supabase Realtime broadcast (channel `party-room-${code}-sketch`) so this
// HTTP write is on a slower cadence (~500ms batched) and not on the per-stroke
// hot path.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

const MAX_BATCH = 64;
const MAX_POINTS_PER_STROKE = 2048;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data: round } = await supabaseAdmin
    .from("sketch_rounds")
    .select("drawer_user_id, ended_at")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.drawer_user_id !== auth.userId) {
    return NextResponse.json({ error: "Only the drawer can draw" }, { status: 403 });
  }
  if (round.ended_at) {
    return NextResponse.json({ error: "Round ended" }, { status: 410 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body?.strokes) ? body.strokes : [];
  if (raw.length === 0) return NextResponse.json({ ok: true, persisted: 0 });
  if (raw.length > MAX_BATCH) {
    return NextResponse.json({ error: "Batch too large" }, { status: 413 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = raw.flatMap((s: any) => {
    if (
      typeof s !== "object" ||
      !s ||
      typeof s.stroke_num !== "number" ||
      typeof s.color !== "string" ||
      typeof s.size !== "number" ||
      !Array.isArray(s.points)
    )
      return [];
    if (s.points.length > MAX_POINTS_PER_STROKE) {
      s.points = s.points.slice(0, MAX_POINTS_PER_STROKE);
    }
    return [
      {
        round_id: params.id,
        stroke_num: s.stroke_num,
        color: s.color.slice(0, 16),
        size: Math.max(1, Math.min(64, Math.floor(s.size))),
        points: s.points,
      },
    ];
  });

  if (rows.length === 0) return NextResponse.json({ ok: true, persisted: 0 });

  const { error } = await supabaseAdmin.from("sketch_strokes").insert(rows);
  if (error) {
    console.error("[party/sketch/strokes] insert", error.message);
    return NextResponse.json({ error: "Couldn't persist strokes" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, persisted: rows.length });
}

// GET — late-joiner replay: read all strokes for the round.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data } = await supabaseAdmin
    .from("sketch_strokes")
    .select("stroke_num, color, size, points")
    .eq("round_id", params.id)
    .order("stroke_num", { ascending: true });
  return NextResponse.json({ strokes: data ?? [] });
}
