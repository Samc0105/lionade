import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/academia/agenda?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Unified calendar feed for the authed user. Merges two date-bearing sources:
 *   - user_exams.target_date  (kind 'exam', no status)
 *   - class_assignments.due_date (kind 'assignment', includes status)
 * into one list sorted by date asc, each item annotated with its class's
 * name / color / emoji so the client can render it without a second fetch.
 *
 * Range:
 *   - from/to are optional. Default: from = today, to = today + 60 days.
 *   - Both must be YYYY-MM-DD if supplied; bad input falls back to default.
 *   - The window is clamped to <= 120 days to bound the query. If `to` is
 *     past from + 120 days, it's pulled back to from + 120.
 *   - If from > to after parsing, we fall back to the default window.
 */

const VALID_STATUS = ["todo", "doing", "done"] as const;
type Status = (typeof VALID_STATUS)[number];

interface AgendaItem {
  id: string;
  kind: "exam" | "assignment";
  date: string;
  title: string;
  status?: Status;
  classId: string;
  className: string;
  classColor: string;
  classEmoji: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 120;
const DEFAULT_FORWARD_DAYS = 60;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Add `days` to a YYYY-MM-DD string, returning YYYY-MM-DD (UTC math). */
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole-day difference b - a (both YYYY-MM-DD). */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  // Resolve the window. Default = [today, today+60]. Bad/missing input falls
  // back to the default; the range is then clamped to <= 120 days.
  const today = todayUtc();
  let from = fromParam && DATE_RE.test(fromParam) ? fromParam : today;
  let to = toParam && DATE_RE.test(toParam) ? toParam : addDays(from, DEFAULT_FORWARD_DAYS);

  // Inverted range is meaningless; reset to the default window from `from`.
  if (daysBetween(from, to) < 0) {
    from = today;
    to = addDays(from, DEFAULT_FORWARD_DAYS);
  }

  // Clamp the span to bound the query.
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    to = addDays(from, MAX_RANGE_DAYS);
  }

  try {
    // Pull exams + assignments in range, in parallel. Both are user-scoped at
    // the query level (service-role client bypasses RLS, so the explicit
    // user_id filter is the security boundary here).
    const [examsRes, assignmentsRes] = await Promise.all([
      supabaseAdmin
        .from("user_exams")
        .select("id, class_id, title, target_date")
        .eq("user_id", userId)
        .eq("archived", false)
        .not("target_date", "is", null)
        .gte("target_date", from)
        .lte("target_date", to),
      supabaseAdmin
        .from("class_assignments")
        .select("id, class_id, title, due_date, status")
        .eq("user_id", userId)
        .not("due_date", "is", null)
        .gte("due_date", from)
        .lte("due_date", to),
    ]);

    if (examsRes.error) throw examsRes.error;
    if (assignmentsRes.error) throw assignmentsRes.error;

    const exams = examsRes.data ?? [];
    const assignments = assignmentsRes.data ?? [];

    // Resolve the class metadata for every class referenced by either source.
    const classIds = Array.from(
      new Set(
        [...exams, ...assignments]
          .map(r => r.class_id)
          .filter((id): id is string => !!id),
      ),
    );

    const classById = new Map<
      string,
      { name: string; color: string; emoji: string | null }
    >();
    if (classIds.length) {
      const { data: classes, error: clsErr } = await supabaseAdmin
        .from("classes")
        .select("id, name, color, emoji")
        .in("id", classIds)
        .eq("user_id", userId);
      if (clsErr) throw clsErr;
      for (const c of classes ?? []) {
        classById.set(c.id, { name: c.name, color: c.color, emoji: c.emoji });
      }
    }

    const items: AgendaItem[] = [];

    for (const e of exams) {
      if (!e.target_date) continue;
      // Standalone exam targets (Mastery exams created without a class) have a
      // null class_id. They still belong on the calendar, so render them with a
      // neutral "Mastery" treatment instead of dropping them. A class-attached
      // exam whose class is missing/owned by someone else is still skipped.
      let className = "Mastery";
      let classColor = "#FFD700"; // Academia gold for class-less targets
      let classEmoji: string | null = null;
      let classId = "";
      if (e.class_id) {
        const cls = classById.get(e.class_id);
        if (!cls) continue;
        className = cls.name;
        classColor = cls.color;
        classEmoji = cls.emoji;
        classId = e.class_id;
      }
      items.push({
        id: e.id,
        kind: "exam",
        date: e.target_date,
        title: e.title,
        classId,
        className,
        classColor,
        classEmoji,
      });
    }

    for (const a of assignments) {
      if (!a.class_id || !a.due_date) continue;
      const cls = classById.get(a.class_id);
      if (!cls) continue;
      items.push({
        id: a.id,
        kind: "assignment",
        date: a.due_date,
        title: a.title,
        // Validate against the known set rather than blind-casting: a stray or
        // legacy DB value would otherwise reach the client, where the status
        // meta lookup has no fallback and would throw. Unknown/null -> "todo".
        // typeof guard narrows a.status to string so this holds even if the
        // column type is string | null.
        status: typeof a.status === "string" && (VALID_STATUS as readonly string[]).includes(a.status) ? (a.status as Status) : "todo",
        classId: a.class_id,
        className: cls.name,
        classColor: cls.color,
        classEmoji: cls.emoji,
      });
    }

    // Sort by date asc; tie-break exams before assignments for a stable order.
    items.sort((x, y) => {
      if (x.date !== y.date) return x.date < y.date ? -1 : 1;
      if (x.kind !== y.kind) return x.kind === "exam" ? -1 : 1;
      return 0;
    });

    return NextResponse.json({ items });
  } catch (e) {
    console.error("[academia/agenda GET]", e);
    return NextResponse.json({ error: "Couldn't load your agenda." }, { status: 500 });
  }
}
