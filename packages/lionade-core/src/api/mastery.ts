/**
 * Mastery Mode API — chat-first Ninny session orchestrator.
 *
 * Flow:
 *   1. POST /api/mastery/exams/[examId]/sessions → { sessionId, resumed }
 *      Idempotent — resumes an active session if one exists.
 *   2. GET  /api/mastery/sessions/[sessionId]    → MasterySessionResponse
 *   3. POST /api/mastery/sessions/[id]/next      → advance the orchestrator
 *   4. POST /api/mastery/sessions/[id]/answer    → submit the user's choice
 *   5. POST /api/mastery/exams                   → create a new exam (NewMasteryExamModal)
 */

import type { ApiClient, ApiResult } from "./http.js";

// ── Domain types ─────────────────────────────────────────────────────────

export interface MasteryMessage {
  id: string;
  role: "user" | "assistant" | string;
  kind: string | null;
  content: string | null;
  payload: Record<string, unknown> | null;
  p_pass_after: number | null;
  display_pct_after: number | null;
  created_at: string;
}

export interface MasteryPending {
  type: "teach" | "question" | "socratic";
  messageId?: string;
  subtopicId?: string;
  questionId?: string;
  challengeToken?: string;
  [k: string]: unknown;
}

export interface MasterySubtopic {
  id: string;
  slug: string;
  name: string;
  weight: number;
  shortSummary: string | null;
  pMastery: number;
  attempts: number;
  correct: number;
  currentStreak: number;
  displayPct: number;
}

export interface MasterySessionResponse {
  session: {
    id: string;
    status: string;
    questionsAnswered: number;
    correctCount: number;
    currentPPass: number | null;
    reachedMasteryAt: string | null;
    pending: MasteryPending | null;
  };
  exam: {
    id: string;
    title: string;
    targetDate: string | null;
    reachedMasteryAt: string | null;
  };
  subtopics: MasterySubtopic[];
  messages: MasteryMessage[];
  pPass: number;
  overallDisplayPct: number;
  ready: boolean;
  mastered: boolean;
}

export interface CreateExamPayload {
  title: string;
  /** Optional ISO date — target test date for countdown UI. */
  targetDate?: string | null;
  /** Optional source material to seed the orchestrator's first topic decomposition. */
  rawContent?: string | null;
}

export interface CreateExamResponse {
  exam: { id: string; title: string };
}

/**
 * Free-form input that /api/mastery/parse will AI-normalize into a title +
 * subtopic decomposition and persist as a new exam. Used by the
 * "What do you want to master?" entry form.
 */
export interface ParseExamPayload {
  /** Raw user input like "AWS Security Specialty" or "AP Calc AB chapter 5". 3..8192 chars. */
  input: string;
}

export interface ParseExamResponse {
  exam: { id: string; title: string };
}

// ── Methods ──────────────────────────────────────────────────────────────

export const masteryAPI = {
  /** POST /api/mastery/exams — create a new mastery exam from a structured payload. */
  createExam(
    client: ApiClient,
    payload: CreateExamPayload,
  ): Promise<ApiResult<CreateExamResponse>> {
    return client.post<CreateExamResponse>("/api/mastery/exams", payload);
  },

  /** POST /api/mastery/parse — AI-parse messy free-form input into an exam title + subtopic decomposition. */
  parseExam(
    client: ApiClient,
    payload: ParseExamPayload,
  ): Promise<ApiResult<ParseExamResponse>> {
    return client.post<ParseExamResponse>("/api/mastery/parse", payload);
  },

  /** POST /api/mastery/exams/[examId]/sessions — start or resume the active session. */
  startSession(
    client: ApiClient,
    examId: string,
  ): Promise<ApiResult<{ sessionId: string; resumed: boolean }>> {
    return client.post<{ sessionId: string; resumed: boolean }>(
      `/api/mastery/exams/${examId}/sessions`,
      {},
    );
  },

  /** GET /api/mastery/sessions/[sessionId] — full session snapshot. */
  getSession(
    client: ApiClient,
    sessionId: string,
  ): Promise<ApiResult<MasterySessionResponse>> {
    return client.get<MasterySessionResponse>(`/api/mastery/sessions/${sessionId}`);
  },

  /** POST /api/mastery/sessions/[id]/next — ask the orchestrator for the next teach/question. */
  advance(
    client: ApiClient,
    sessionId: string,
  ): Promise<ApiResult<unknown>> {
    return client.post(`/api/mastery/sessions/${sessionId}/next`, {});
  },

  /** POST /api/mastery/sessions/[id]/answer — submit the user's selected answer index. */
  submitAnswer(
    client: ApiClient,
    sessionId: string,
    selectedIndex: number,
    challengeToken: string,
  ): Promise<ApiResult<unknown>> {
    return client.post(`/api/mastery/sessions/${sessionId}/answer`, {
      selectedIndex,
      challengeToken,
    });
  },
} as const;
