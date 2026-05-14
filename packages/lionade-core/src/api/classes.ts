/**
 * Classes API — list user's classes + create a new class.
 *
 * GET /api/classes returns the user's classes joined with note + exam
 * counts and next-exam metadata.
 * POST /api/classes creates a new class.
 *
 * Usage:
 *   const r = await classesAPI.list(apiClient);
 *   const created = await classesAPI.create(apiClient, payload);
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface ClassSummary {
  id: string;
  name: string;
  shortCode: string | null;
  professor: string | null;
  term: string | null;
  color: string;
  emoji: string | null;
  position: number;
  examCount: number;
  noteCount: number;
  /** ISO date of the soonest upcoming exam, or null. */
  nextExamDate: string | null;
  overallDisplayPct: number;
  updatedAt: string;
}

export interface CreateClassPayload {
  name: string;
  shortCode?: string | null;
  professor?: string | null;
  term?: string | null;
  color?: string;
  emoji?: string | null;
}

export interface CreateClassResponse {
  classId: string;
}

export interface RecentNote {
  id: string;
  title: string | null;
  preview: string;
  pinned: boolean;
  updatedAt: string;
  classId: string;
  className: string;
  classColor: string;
  classEmoji: string | null;
  classShortCode: string | null;
}

export interface QuickNotePayload {
  body: string;
  /** Class to attach the note to. Server falls back to a default if omitted. */
  classId?: string | null;
}

export interface QuickNoteResponse {
  noteId: string;
  classId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Syllabus types — shared by web + iOS
// ─────────────────────────────────────────────────────────────────────────────

export type SyllabusStatus = "uploaded" | "parsing" | "parsed" | "failed";

export interface ParsedSyllabusTopic {
  topic: string;
  week_n: number | null;
  est_hours: number | null;
}

export interface ParsedSyllabusExam {
  name: string;
  date_iso: string | null;
  weight_pct: number | null;
}

export interface SyllabusRow {
  id: string;
  filename: string;
  fileSizeBytes: number;
  status: SyllabusStatus;
  parseError: string | null;
  parsedTopics: ParsedSyllabusTopic[];
  parsedExams: ParsedSyllabusExam[];
  createdAt: string;
  updatedAt: string;
}

export interface RegisterSyllabusPayload {
  /** Path inside the `class-syllabi` Supabase Storage bucket where the PDF lives. */
  storagePath: string;
  /** Display filename — shown back to the user in the parsed pill. */
  filename: string;
  fileSizeBytes: number;
}

export interface RegisterSyllabusResponse {
  ok: boolean;
  syllabusId: string;
  topicsCount: number;
  examsCount: number;
}

export const classesAPI = {
  list(client: ApiClient): Promise<ApiResult<{ classes: ClassSummary[] }>> {
    return client.get<{ classes: ClassSummary[] }>("/api/classes");
  },
  create(
    client: ApiClient,
    payload: CreateClassPayload,
  ): Promise<ApiResult<CreateClassResponse>> {
    return client.post<CreateClassResponse>("/api/classes", payload);
  },
  recentNotes(
    client: ApiClient,
  ): Promise<ApiResult<{ notes: RecentNote[] }>> {
    return client.get<{ notes: RecentNote[] }>("/api/classes/recent-notes");
  },
  quickNote(
    client: ApiClient,
    payload: QuickNotePayload,
  ): Promise<ApiResult<QuickNoteResponse>> {
    return client.post<QuickNoteResponse>("/api/classes/quick-note", payload);
  },
  /**
   * Get the most-recent syllabus row for a class. Returns `{ syllabus: null }`
   * when the class has never had a syllabus uploaded.
   */
  getSyllabus(
    client: ApiClient,
    classId: string,
  ): Promise<ApiResult<{ syllabus: SyllabusRow | null }>> {
    return client.get<{ syllabus: SyllabusRow | null }>(
      `/api/classes/${classId}/syllabus`,
    );
  },
  /**
   * Register an already-uploaded syllabus PDF and trigger the AI parse.
   * The caller is responsible for uploading the file to Supabase Storage at
   * `${userId}/${classId}/<uuid>.pdf` before invoking this method.
   */
  uploadSyllabus(
    client: ApiClient,
    classId: string,
    payload: RegisterSyllabusPayload,
  ): Promise<ApiResult<RegisterSyllabusResponse>> {
    return client.post<RegisterSyllabusResponse>(
      `/api/classes/${classId}/syllabus`,
      payload,
    );
  },
} as const;
