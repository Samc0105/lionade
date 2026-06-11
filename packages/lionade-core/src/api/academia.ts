/**
 * Academia API — cross-class hub feeds shared by web + iOS.
 *
 * Wraps the platform-neutral routes:
 *   GET  /api/academia/agenda?from&to   → { items: AgendaItem[] }
 *   GET  /api/academia/gpa              → GpaSnapshot
 *   POST /api/academia/import-ics       → preview { url } | commit { classId, events }
 *
 * Plus the per-class assignment CRUD that backs the agenda feed:
 *   GET    /api/classes/[id]/assignments
 *   POST   /api/classes/[id]/assignments
 *   PATCH  /api/classes/assignments/[assignmentId]
 *   DELETE /api/classes/assignments/[assignmentId]
 *
 * Response shapes mirror the web routes EXACTLY (verified against the live
 * route handlers): agenda returns { items }, gpa returns the flat snapshot,
 * import-ics preview returns { events, count, truncated } and commit returns
 * { created }. Assignment list returns { assignments }, single mutations
 * return { assignment }.
 */

import type { ApiClient, ApiResult } from "./http.js";

// ─────────────────────────────────────────────────────────────────────────────
// Agenda — unified exam + assignment calendar feed
// ─────────────────────────────────────────────────────────────────────────────

export type AssignmentStatus = "todo" | "doing" | "done";

export interface AgendaItem {
  id: string;
  kind: "exam" | "assignment";
  /** YYYY-MM-DD */
  date: string;
  title: string;
  /** Present only on assignments. */
  status?: AssignmentStatus;
  classId: string;
  className: string;
  classColor: string;
  classEmoji: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPA — cross-class roll-up
// ─────────────────────────────────────────────────────────────────────────────

export interface GpaClass {
  classId: string;
  className: string;
  classColor: string;
  currentPct: number | null;
  letter: string | null;
  gpaPoints: number | null;
}

export interface GpaSnapshot {
  termGpa: number | null;
  gradedClasses: number;
  scale: string;
  classes: GpaClass[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ICS import
// ─────────────────────────────────────────────────────────────────────────────

export interface IcsEvent {
  title: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface IcsPreviewResponse {
  events: IcsEvent[];
  count: number;
  truncated: boolean;
}

export interface IcsCommitResponse {
  created: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assignments
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassAssignment {
  id: string;
  class_id: string;
  title: string;
  /** YYYY-MM-DD or null. */
  due_date: string | null;
  status: AssignmentStatus;
  created_at: string;
}

export interface CreateAssignmentPayload {
  title: string;
  due_date?: string | null;
  status?: AssignmentStatus;
}

export interface UpdateAssignmentPayload {
  title?: string;
  due_date?: string | null;
  status?: AssignmentStatus;
}

export const academiaAPI = {
  /**
   * Unified calendar feed. from/to are optional YYYY-MM-DD; server defaults to
   * [today, today+60] and clamps the span to <= 120 days.
   */
  agenda(
    client: ApiClient,
    range?: { from?: string; to?: string },
  ): Promise<ApiResult<{ items: AgendaItem[] }>> {
    const qs = new URLSearchParams();
    if (range?.from) qs.set("from", range.from);
    if (range?.to) qs.set("to", range.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return client.get<{ items: AgendaItem[] }>(`/api/academia/agenda${suffix}`);
  },

  gpa(client: ApiClient): Promise<ApiResult<GpaSnapshot>> {
    return client.get<GpaSnapshot>("/api/academia/gpa");
  },

  /** PREVIEW mode — fetch + parse an .ics feed URL server-side (SSRF-guarded). */
  importIcsPreview(
    client: ApiClient,
    url: string,
  ): Promise<ApiResult<IcsPreviewResponse>> {
    return client.post<IcsPreviewResponse>("/api/academia/import-ics", { url });
  },

  /** COMMIT mode — persist selected events as class_assignments for a class. */
  importIcsCommit(
    client: ApiClient,
    classId: string,
    events: IcsEvent[],
  ): Promise<ApiResult<IcsCommitResponse>> {
    return client.post<IcsCommitResponse>("/api/academia/import-ics", {
      classId,
      events,
    });
  },

  listAssignments(
    client: ApiClient,
    classId: string,
  ): Promise<ApiResult<{ assignments: ClassAssignment[] }>> {
    return client.get<{ assignments: ClassAssignment[] }>(
      `/api/classes/${classId}/assignments`,
    );
  },

  createAssignment(
    client: ApiClient,
    classId: string,
    payload: CreateAssignmentPayload,
  ): Promise<ApiResult<{ assignment: ClassAssignment }>> {
    return client.post<{ assignment: ClassAssignment }>(
      `/api/classes/${classId}/assignments`,
      payload,
    );
  },

  updateAssignment(
    client: ApiClient,
    assignmentId: string,
    payload: UpdateAssignmentPayload,
  ): Promise<ApiResult<{ assignment: ClassAssignment }>> {
    return client.patch<{ assignment: ClassAssignment }>(
      `/api/classes/assignments/${assignmentId}`,
      payload,
    );
  },

  deleteAssignment(
    client: ApiClient,
    assignmentId: string,
  ): Promise<ApiResult<{ ok: true }>> {
    return client.delete<{ ok: true }>(
      `/api/classes/assignments/${assignmentId}`,
    );
  },
} as const;
