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

// ─────────────────────────────────────────────────────────────────────────────
// Class flashcards — spaced-repetition study deck per class
// ─────────────────────────────────────────────────────────────────────────────

export type FlashcardRating = "again" | "hard" | "good" | "easy";

export interface ClassFlashcard {
  id: string;
  question: string;
  answer: string;
  source: "ai_note" | "manual" | string;
  ease: number;
  intervalDays: number;
  nextDueAt: string;
  reviews: number;
  sourceNoteId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListFlashcardsResponse {
  cards: ClassFlashcard[];
  dueCount: number;
}

export interface RateFlashcardResponse {
  card: ClassFlashcard;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grade tracker — per-class weighted grades with "needed on final" calc
// ─────────────────────────────────────────────────────────────────────────────

export type GradeCategory = "Exam" | "Quiz" | "Homework" | "Project" | "Other";

export interface ClassGrade {
  id: string;
  name: string;
  category: GradeCategory | string | null;
  earnedPoints: number | null;
  maxPoints: number;
  weightPct: number;
  isFinal: boolean;
  dueDate: string | null;
  gradedAt: string | null;
  /** earned / max as a percent (0-100), rounded to 1 decimal. Null until graded. */
  pct: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClassGradeSummary {
  /** Σ (weight_i × pct_i) / Σ weight_i over graded rows. Null when nothing graded. */
  currentWeightedPct: number | null;
  gradedCount: number;
  ungradedCount: number;
  finalRow: { id: string; name: string; weightPct: number } | null;
  /** Percent needed on the final to land an A (90+). >100 means unreachable. */
  neededOnFinalForA: number | null;
  neededOnFinalForB: number | null;
}

export interface ClassGradesResponse {
  grades: ClassGrade[];
  summary: ClassGradeSummary;
}

export interface CreateGradePayload {
  name: string;
  category?: GradeCategory | null;
  earned_points?: number | null;
  max_points: number;
  weight_pct: number;
  is_final?: boolean;
  due_date?: string | null;
  graded_at?: string | null;
}

export interface UpdateGradePayload {
  name?: string;
  category?: GradeCategory | null;
  earned_points?: number | null;
  max_points?: number;
  weight_pct?: number;
  is_final?: boolean;
  due_date?: string | null;
  graded_at?: string | null;
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
  /**
   * List all non-archived flashcards for a class, ordered by next_due_at
   * (server-side). The `dueCount` is the number with nextDueAt <= now.
   */
  listFlashcards(
    client: ApiClient,
    classId: string,
  ): Promise<ApiResult<ListFlashcardsResponse>> {
    return client.get<ListFlashcardsResponse>(
      `/api/classes/${classId}/flashcards`,
    );
  },
  /**
   * Record a review rating on a flashcard. The server recomputes the SR
   * state (ease, interval, next_due_at) using an SM-2-style algorithm and
   * returns the updated card.
   */
  rateFlashcard(
    client: ApiClient,
    classId: string,
    cardId: string,
    rating: FlashcardRating,
  ): Promise<ApiResult<RateFlashcardResponse>> {
    return client.patch<RateFlashcardResponse>(
      `/api/classes/${classId}/flashcards/${cardId}`,
      { rating },
    );
  },
  /**
   * List all grade rows for a class plus the computed summary (current
   * weighted grade, graded/ungraded counts, needed-on-final percentages).
   * Server does the math so the client never has to.
   */
  listGrades(
    client: ApiClient,
    classId: string,
  ): Promise<ApiResult<ClassGradesResponse>> {
    return client.get<ClassGradesResponse>(`/api/classes/${classId}/grades`);
  },
  createGrade(
    client: ApiClient,
    classId: string,
    payload: CreateGradePayload,
  ): Promise<ApiResult<{ grade: ClassGrade }>> {
    return client.post<{ grade: ClassGrade }>(
      `/api/classes/${classId}/grades`,
      payload,
    );
  },
  updateGrade(
    client: ApiClient,
    classId: string,
    gradeId: string,
    payload: UpdateGradePayload,
  ): Promise<ApiResult<{ grade: ClassGrade }>> {
    return client.patch<{ grade: ClassGrade }>(
      `/api/classes/${classId}/grades/${gradeId}`,
      payload,
    );
  },
  deleteGrade(
    client: ApiClient,
    classId: string,
    gradeId: string,
  ): Promise<ApiResult<null>> {
    return client.delete<null>(`/api/classes/${classId}/grades/${gradeId}`);
  },
} as const;
