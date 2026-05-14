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
} as const;
