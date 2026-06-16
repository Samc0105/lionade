import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireRole } from "@/lib/admin-auth";

/**
 * GET /api/admin/audit-log/export — downloadable export of the full filtered
 * admin_audit_log. ADMIN ONLY. Read-only: this never mutates the append-only
 * log.
 *
 * Query params:
 *   format     — "json" | "csv" (default "json")
 *   action     — exact action filter (password_reset, fangs_adjust, ...)
 *   user       — uuid, matches EITHER performer or target
 *   startDate  — ISO timestamp, inclusive lower bound on created_at
 *   endDate    — ISO timestamp, inclusive upper bound on created_at
 *
 * The whole filtered set is paged out of Supabase (newest first, ~1000 rows
 * per page) until exhausted, then performer/target usernames are resolved from
 * profiles in a single batched query. The response carries a Content-Disposition
 * attachment header so the browser saves it as audit-log-<date>.csv / .json.
 *
 * Metadata is secret-scrubbed at write time, so it is safe to include verbatim.
 */

const FETCH_PAGE = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuditRow {
  id: string;
  performed_by: string;
  action: string;
  target_user_id: string | null;
  metadata: unknown;
  created_at: string;
}

interface ExportEntry {
  id: string;
  action: string;
  performedBy: string;
  performedByName: string;
  targetUserId: string | null;
  targetName: string | null;
  metadata: unknown;
  createdAt: string;
}

/** Wraps a value as a CSV field: stringify, double internal quotes, quote it.
 * Also neutralizes spreadsheet formula injection: a cell beginning with
 * = + - @ (or a tab/CR) is executed as a formula by Excel/Sheets, so we prefix
 * a single quote to force it to render as literal text. usernames + actions can
 * carry attacker-influenced values, so this guard runs on every field. */
function csvField(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(entries: ExportEntry[]): string {
  const header = [
    "id",
    "created_at",
    "action",
    "performed_by",
    "performed_by_name",
    "target_user_id",
    "target_name",
    "metadata",
  ]
    .map(csvField)
    .join(",");

  const lines = entries.map((e) =>
    [
      e.id,
      e.createdAt,
      e.action,
      e.performedBy,
      e.performedByName,
      e.targetUserId ?? "",
      e.targetName ?? "",
      // metadata is an object; csvField will JSON.stringify it
      e.metadata ?? {},
    ]
      .map(csvField)
      .join(","),
  );

  // CRLF line endings are the safest for spreadsheet imports.
  return [header, ...lines].join("\r\n");
}

export async function GET(req: NextRequest) {
  const staff = await requireRole(req, "admin");
  if (staff instanceof NextResponse) return staff;

  const sp = req.nextUrl.searchParams;

  const formatRaw = (sp.get("format") ?? "json").trim().toLowerCase();
  const format = formatRaw === "csv" ? "csv" : "json";

  const action = (sp.get("action") ?? "").trim().slice(0, 50);
  const userFilter = (sp.get("user") ?? "").trim();
  const startDate = (sp.get("startDate") ?? "").trim();
  const endDate = (sp.get("endDate") ?? "").trim();

  // Validate optional date bounds; ignore anything unparseable rather than 500.
  const startIso =
    startDate && !Number.isNaN(Date.parse(startDate)) ? startDate : null;
  const endIso = endDate && !Number.isNaN(Date.parse(endDate)) ? endDate : null;

  const rows: AuditRow[] = [];
  for (let page = 0; ; page++) {
    let query = supabaseAdmin
      .from("admin_audit_log")
      .select("id, performed_by, action, target_user_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .range(page * FETCH_PAGE, page * FETCH_PAGE + FETCH_PAGE - 1);

    if (action) query = query.eq("action", action);
    if (UUID_RE.test(userFilter)) {
      query = query.or(
        `performed_by.eq.${userFilter},target_user_id.eq.${userFilter}`,
      );
    }
    if (startIso) query = query.gte("created_at", startIso);
    if (endIso) query = query.lte("created_at", endIso);

    const { data, error } = await query;
    if (error) {
      console.error("[admin/audit-log/export] query failed:", error.message);
      return NextResponse.json(
        { error: "Audit log export unavailable" },
        { status: 500 },
      );
    }

    const batch = (data ?? []) as AuditRow[];
    rows.push(...batch);
    if (batch.length < FETCH_PAGE) break;
  }

  const ids = Array.from(
    new Set(
      rows.flatMap((r) => [r.performed_by, r.target_user_id]).filter(Boolean),
    ),
  ) as string[];

  const usernames: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .in("id", ids);
    if (profErr) {
      console.error("[admin/audit-log/export] name lookup failed:", profErr.message);
      return NextResponse.json(
        { error: "Audit log export unavailable" },
        { status: 500 },
      );
    }
    for (const p of profiles ?? []) usernames[p.id] = p.username ?? p.id;
  }

  const entries: ExportEntry[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    performedBy: r.performed_by,
    performedByName: usernames[r.performed_by] ?? r.performed_by,
    targetUserId: r.target_user_id,
    targetName: r.target_user_id
      ? (usernames[r.target_user_id] ?? r.target_user_id)
      : null,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  }));

  // YYYY-MM-DD in UTC for a stable, sortable filename.
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const body = toCsv(entries);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const body = JSON.stringify(
    { entries, total: entries.length, exportedAt: new Date().toISOString() },
    null,
    2,
  );
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
