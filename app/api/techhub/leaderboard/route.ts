import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { gradeFor } from "@/lib/liondesk/scoring";
import { weekSeed } from "@/lib/liondesk/generate";

// ── The Board: a ranked leaderboard for the three shared deterministic modes ──
// Daily Combo, Daily Chaos, and the Weekly Challenge are seeded so every player
// gets the exact same shift in a period, which is what makes a fair ranking
// possible. This route serves the top N for the CURRENT period and records a
// player's best score. It ranks GRADES and SCORES only and never touches the
// economy (no Fangs are read, written, or granted here).
//
// Server-authoritative posture mirrors the shift-completions route: auth via
// requireAuth, the score is clamped server-side, the grade is DERIVED from the
// clamped score (never trusted from the client), and the period key is computed
// here (never accepted from the body) so a crafted client cannot plant a fake
// grade or back-date a period.
//
// The held migration (20260628120000) creates techhub_leaderboard. Until it is
// applied the table is absent: both handlers detect that and answer with
// { liveYet: false } so the Board UI shows a clean preview instead of erroring.

const MODES = ["combo", "chaos", "weekly"] as const;
type BoardMode = (typeof MODES)[number];

function isBoardMode(v: unknown): v is BoardMode {
  return typeof v === "string" && (MODES as readonly string[]).includes(v);
}

// Seasons: each shared mode runs as a sequence of periods (a day for the two
// dailies, a week for the weekly). "current" is the live period a player can
// still post into; "previous" is the last completed period, exposed read only so
// a season archive (the final standings of the day or week just gone) can be
// viewed. The period is the only season control, and it is read off a query
// param; the period KEY itself stays server computed and seed aligned (below), so
// the client can ask to look back but can never name or back date a bucket.
type Period = "current" | "previous";

function isPeriod(v: string | null): v is Period {
  return v === "current" || v === "previous";
}

const DAY_MS = 86400000;

// A Postgres "relation does not exist" error means the held migration has not
// been applied yet. Same detection the shift-completions route uses.
function tableMissing(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === "42P01" || /relation .* does not exist/i.test(err.message ?? ""));
}

// Clamp any reported score into the 0..100 integer range. A non-finite value
// (e.g. Number("x") -> NaN) becomes 0, never violating the int column.
function toScore(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

// The period key shared by every player in a given period. Computed server-side
// so the bucket cannot be spoofed or back-dated. The board bucket must roll over
// on the SAME boundary as the shift it ranks, otherwise two different
// deterministic shifts would be pooled into one ladder or a ladder would reset
// mid-shift. So each key is derived from the exact seed its shift is generated
// from. The two dailies key on the UTC calendar day, which equals dateSeed's day
// (see lib/liondesk/generate). The weekly keys on weekSeed(now), the exact seed
// the Weekly Challenge shift is generated from, so the ladder always ranks a
// single deterministic shift against itself for that shift's whole life.
//
// The "previous" period (the season archive) is the very same calculation run
// one bucket back: one UTC day earlier for a daily, one week earlier for the
// weekly. We shift the reference instant back through the SAME seed machinery
// rather than parsing or decrementing a key string, so an archived key is always
// a real past key the shift was once generated from, and stays seed aligned.
function periodKeyFor(mode: BoardMode, period: Period = "current", now: Date = new Date()): string {
  const at = period === "previous"
    ? new Date(now.getTime() - (mode === "weekly" ? 7 : 1) * DAY_MS)
    : now;
  if (mode === "weekly") return `weekly-${weekSeed(at)}`;
  return at.toISOString().slice(0, 10); // YYYY-MM-DD (UTC day, matches dateSeed)
}

interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  grade: string;
  you: boolean;
}

// GET top N for a mode in a period (the current live period by default, or the
// previous period's archive with ?period=previous), plus the signed-in player's
// own standing for that period (even when they fall outside the top N).
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const url = new URL(req.url);
  const modeParam = url.searchParams.get("mode");
  const mode: BoardMode = isBoardMode(modeParam) ? modeParam : "combo";
  const periodParam = url.searchParams.get("period");
  const period: Period = isPeriod(periodParam) ? periodParam : "current";
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.round(rawLimit))) : 10;
  const periodKey = periodKeyFor(mode, period);

  const { data, error } = await supabaseAdmin
    .from("techhub_leaderboard")
    .select("user_id, best_score, best_grade, updated_at")
    .eq("mode", mode)
    .eq("period_key", periodKey)
    .order("best_score", { ascending: false })
    .order("updated_at", { ascending: true }) // earliest to reach a score ranks higher on a tie
    .limit(limit);

  if (error) {
    // Migration not applied yet (table missing): the Board shows its preview.
    if (tableMissing(error)) {
      return NextResponse.json({ liveYet: false, mode, period, periodKey, entries: [], you: null });
    }
    return NextResponse.json({ error: "Couldn't load the board." }, { status: 500 });
  }

  const rows = data ?? [];

  // One batched profile read for every name shown (same pattern as arena).
  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  if (!ids.includes(userId)) ids.push(userId);
  const nameMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, username, display_name")
      .in("id", ids);
    for (const p of profiles ?? []) {
      nameMap.set(p.id, (p.username as string) || (p.display_name as string) || "Player");
    }
  }

  const entries: BoardEntry[] = rows.map((r, i) => ({
    rank: i + 1,
    name: nameMap.get(r.user_id) ?? "Player",
    score: r.best_score,
    grade: r.best_grade,
    you: r.user_id === userId,
  }));

  // The player's own standing. If they are already in the top N, reuse that row;
  // otherwise look up their best for the period and count how many beat it.
  let you: BoardEntry | null = entries.find((e) => e.you) ?? null;
  if (!you) {
    const { data: mine } = await supabaseAdmin
      .from("techhub_leaderboard")
      .select("best_score, best_grade, updated_at")
      .eq("mode", mode)
      .eq("period_key", periodKey)
      .eq("user_id", userId)
      .maybeSingle();
    if (mine) {
      // Rank exactly the way the ladder above is ordered (best_score desc, then
      // updated_at asc). Count everyone strictly above on score, PLUS anyone tied
      // on score who reached it earlier, so a player tied with someone already
      // shown in the top N gets the next rank down rather than sharing that rank.
      // The two counts run in parallel and only on the outside top N path.
      const [aboveRes, tiedEarlierRes] = await Promise.all([
        supabaseAdmin
          .from("techhub_leaderboard")
          .select("user_id", { count: "exact", head: true })
          .eq("mode", mode)
          .eq("period_key", periodKey)
          .gt("best_score", mine.best_score),
        supabaseAdmin
          .from("techhub_leaderboard")
          .select("user_id", { count: "exact", head: true })
          .eq("mode", mode)
          .eq("period_key", periodKey)
          .eq("best_score", mine.best_score)
          .lt("updated_at", mine.updated_at),
      ]);
      you = {
        rank: (aboveRes.count ?? 0) + (tiedEarlierRes.count ?? 0) + 1,
        name: nameMap.get(userId) ?? "You",
        score: mine.best_score,
        grade: mine.best_grade,
        you: true,
      };
    }
  }

  return NextResponse.json({ liveYet: true, mode, period, periodKey, entries, you });
}

// POST a score for one of the three shared modes. The score is clamped and the
// grade is derived server-side; the period key is computed here. We keep the
// player's BEST score for the current period (one row per user per period). This
// grants nothing: the economy lives in the shift-completions route.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = (await req.json().catch(() => null)) as { mode?: string; score?: number } | null;
  if (!isBoardMode(body?.mode)) {
    return NextResponse.json({ error: "Unknown mode." }, { status: 400 });
  }
  const mode: BoardMode = body.mode;
  const score = toScore(body?.score);
  // Writes only ever land in the CURRENT period. The previous period is the
  // read only season archive (GET ?period=previous); there is no path to post
  // into a closed period, so a finished bucket can never be edited after the fact.
  const periodKey = periodKeyFor(mode, "current");

  // Load any existing standing for this period to keep the best score.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("techhub_leaderboard")
    .select("best_score")
    .eq("user_id", userId)
    .eq("mode", mode)
    .eq("period_key", periodKey)
    .maybeSingle();

  if (readErr && tableMissing(readErr)) {
    return NextResponse.json({ ok: false, liveYet: false });
  }
  if (readErr) {
    return NextResponse.json({ error: "Couldn't save your score." }, { status: 500 });
  }

  const prevBest = existing?.best_score ?? 0;
  const bestScore = Math.max(score, prevBest);
  const bestGrade = gradeFor(bestScore); // derived server-side, never trusted
  const updatedAt = new Date().toISOString();

  if (!existing) {
    const { error: insErr } = await supabaseAdmin
      .from("techhub_leaderboard")
      .insert({ user_id: userId, mode, period_key: periodKey, best_score: bestScore, best_grade: bestGrade, updated_at: updatedAt });
    if (insErr) {
      // A concurrent first insert loses on the unique (user, mode, period) key;
      // the winner already stored a best, so the loser simply reports success.
      if (insErr.code === "23505") return NextResponse.json({ ok: true, liveYet: true, bestScore, bestGrade });
      if (tableMissing(insErr)) return NextResponse.json({ ok: false, liveYet: false });
      return NextResponse.json({ error: "Couldn't save your score." }, { status: 500 });
    }
  } else if (score > prevBest) {
    // Advance only upward. The .lt guard keeps a racing lower write from clobbering
    // a higher one already committed by a concurrent request.
    const { error: updErr } = await supabaseAdmin
      .from("techhub_leaderboard")
      .update({ best_score: bestScore, best_grade: bestGrade, updated_at: updatedAt })
      .eq("user_id", userId)
      .eq("mode", mode)
      .eq("period_key", periodKey)
      .lt("best_score", bestScore);
    if (updErr) return NextResponse.json({ error: "Couldn't save your score." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, liveYet: true, bestScore, bestGrade });
}
