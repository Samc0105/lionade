import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * /api/quiz/state — refresh-resumable state for the four solo MCQ-style games:
 *   - quiz       (/quiz)
 *   - blitz      (/compete/blitz)
 *   - roardle    (Wordle-style — UI not yet built)
 *   - timeline   (UI not yet built)
 *
 * Single endpoint, single table (`quiz_session_state`), one row per (user_id,
 * game_type). State shape is jsonb because each game owns its own state
 * model — quiz has a `current_question_index`, blitz has a `timer_remaining_ms`,
 * roardle has `guesses[]`, timeline has `events_remaining[]`. Trying to unify
 * those shapes was rejected — the cost of cross-game leakage outweighs the
 * value of a typed table column.
 *
 * GET  ?game_type=quiz → return saved state, or null.
 * POST { game_type, state } → upsert. Pass `state: null` to clear.
 *
 * Each game page debounces its POSTs to 500ms; this route is rate-limited to
 * 60/min in middleware (`quiz-state` bucket).
 *
 * Schema (Phase 1):
 *   quiz_session_state (
 *     user_id uuid,
 *     game_type text,         -- 'quiz' | 'blitz' | 'roardle' | 'timeline'
 *     state jsonb,
 *     last_active_at timestamptz default now(),
 *     PRIMARY KEY (user_id, game_type)
 *   )
 *
 * Phase 2 — Tier 3 refresh-resumable state. Web ships; iOS port should mirror
 * via AsyncStorage cache. See IOS_PARITY.md row 2026-06-04.
 */

const ALLOWED_GAME_TYPES = new Set(["quiz", "blitz", "roardle", "timeline"]);

interface QuizStateBody {
  game_type?: string;
  state?: unknown;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { searchParams } = new URL(req.url);
  const gameType = searchParams.get("game_type") ?? "";
  if (!ALLOWED_GAME_TYPES.has(gameType)) {
    return NextResponse.json({ error: "Unknown game_type" }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("quiz_session_state")
      .select("game_type, state, last_active_at")
      .eq("user_id", userId)
      .eq("game_type", gameType)
      .maybeSingle();
    if (error) {
      console.warn("[quiz/state GET]", error.message);
      return NextResponse.json({ state: null });
    }
    return NextResponse.json({
      state: data?.state ?? null,
      lastActiveAt: data?.last_active_at ?? null,
    });
  } catch (e) {
    console.error("[quiz/state GET]", e);
    return NextResponse.json({ state: null });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: QuizStateBody;
  try { body = (await req.json()) as QuizStateBody; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const gameType = String(body.game_type ?? "");
  if (!ALLOWED_GAME_TYPES.has(gameType)) {
    return NextResponse.json({ error: "Unknown game_type" }, { status: 400 });
  }

  try {
    if (body.state == null) {
      // Caller asked to clear (game complete, restart, etc.)
      const { error } = await supabaseAdmin
        .from("quiz_session_state")
        .delete()
        .eq("user_id", userId)
        .eq("game_type", gameType);
      if (error) {
        console.error("[quiz/state POST clear]", error.message);
        return NextResponse.json({ error: "Couldn't clear state" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, cleared: true });
    }

    // Defensive bound — keep the jsonb payload small. 32KB is generous for
    // any sane game state (Roardle's guesses[], quiz's answers map, etc.).
    const serialised = JSON.stringify(body.state);
    if (serialised.length > 32_000) {
      return NextResponse.json({ error: "State too large" }, { status: 413 });
    }

    const { error } = await supabaseAdmin
      .from("quiz_session_state")
      .upsert(
        {
          user_id: userId,
          game_type: gameType,
          state: body.state,
          last_active_at: new Date().toISOString(),
        },
        { onConflict: "user_id,game_type" },
      );
    if (error) {
      console.error("[quiz/state POST]", error.message);
      return NextResponse.json({ error: "Couldn't save state" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[quiz/state POST]", e);
    return NextResponse.json({ error: "Couldn't save state" }, { status: 500 });
  }
}
