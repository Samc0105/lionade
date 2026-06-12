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
  /** Optional — attach this exam target to a class notebook. */
  classId?: string | null;
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

/**
 * @deprecated Does NOT match what /api/mastery/parse actually returns — the
 * route never creates an exam; it returns a broad/specific parse result. Use
 * {@link MasteryParseResponse} (via `masteryAPI.parse`) instead. Kept intact
 * because existing consumers reference this type; it will be removed once
 * they migrate.
 */
export interface ParseExamResponse {
  exam: { id: string; title: string };
}

// ── Parse → create flow (real /api/mastery/parse contract) ───────────────

/** One AI-decomposed subtopic from a "specific" parse result. */
export interface MasteryParsedSubtopic {
  /** kebab-case, <= 48 chars, unique within the set. */
  slug: string;
  name: string;
  /** 0..1; the set is renormalized server-side to sum to 1.0. */
  weight: number;
  short_summary: string;
  /** sha1 of (title, subtopic name) — passed through to exam creation. */
  contentHash: string;
}

/** Scope too broad — server asks the user to narrow down. Re-POST with refined input. */
export interface MasteryParseBroad {
  scope: "broad";
  clarification: string;
}

/** Scope specific enough — ready to POST to /api/mastery/exams. */
export interface MasteryParseSpecific {
  scope: "specific";
  title: string;
  /** sha1 of the normalized title. */
  topicHash: string;
  subtopics: MasteryParsedSubtopic[];
}

/**
 * The REAL discriminated response of POST /api/mastery/parse
 * (app/api/mastery/parse/route.ts). Nothing is persisted by the parse —
 * creation happens via `createExamFromParse`.
 */
export type MasteryParseResponse = MasteryParseBroad | MasteryParseSpecific;

/** Payload for POST /api/mastery/exams when creating from a parse result. */
export interface CreateExamFromParsePayload {
  /** The raw user input that produced the parse. <= 8 KB. */
  rawInput: string;
  title: string;
  topicHash: string;
  /** 3..10 subtopics; weights must sum to ~1.0. */
  subtopics: MasteryParsedSubtopic[];
  /** Optional YYYY-MM-DD target test date. */
  targetDate?: string | null;
  /** Optional — attach this exam target to a class notebook. */
  classId?: string | null;
}

export interface CreateExamFromParseResponse {
  examId: string;
}

/**
 * The 403 body POST /api/mastery/exams returns when the user is at their
 * plan's concurrent-target cap. Lands in `ApiResult.data` with ok:false,
 * status 403. Use {@link isMasteryPlanLimit} to narrow.
 */
export interface MasteryPlanLimitError {
  error: "LIMIT";
  plan: string;
  limit: number;
  current: number;
  message: string;
}

export function isMasteryPlanLimit(
  data: unknown,
): data is MasteryPlanLimitError {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { error?: unknown }).error === "LIMIT"
  );
}

/** One row of GET /api/mastery/exams — mirrors web's ExamSummary (app/learn/mastery/page.tsx). */
export interface MasteryExamSummary {
  id: string;
  title: string;
  scope: string;
  targetDate: string | null;
  readyThreshold: number;
  totalActiveSeconds: number;
  reachedMasteryAt: string | null;
  updatedAt: string;
  overallDisplayPct: number;
  subtopicCount: number;
  activeSessionId: string | null;
}

// ── Session side-channels (heartbeat / scratch state / prefetch) ─────────

/**
 * Refresh-resumable scratch state from GET /api/mastery/sessions/[id]/state.
 * Null when no autosave row exists yet.
 */
export interface MasterySessionScratchState {
  currentQuestionId: string | null;
  partialAnswer: string | null;
  answeredCount: number;
  correctCount: number;
  lastActiveAt: string;
}

/** Body for POST /api/mastery/sessions/[id]/state (debounced client autosave). */
export interface SaveMasteryStatePayload {
  current_question_id?: string | null;
  /** Sliced to 2000 chars server-side. */
  partial_answer?: string | null;
  answered_count?: number;
  correct_count?: number;
}

export interface MasteryPrefetchOptions {
  /** Default 5, max 8. */
  count?: number;
  /** "reinforce" stays on lastSubtopicId; "next" rotates weakest subtopics. */
  strategy?: "next" | "reinforce";
  lastSubtopicId?: string;
  /** Question ids already staged in the client queue. */
  avoidIds?: string[];
}

export interface MasteryPrefetchedQuestion {
  questionId: string;
  subtopicId: string;
  subtopicName: string;
  question: string;
  options: string[];
  difficulty: string;
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

  /**
   * POST /api/mastery/parse — AI-parse messy free-form input into an exam title + subtopic decomposition.
   * @deprecated The response generic is wrong (the route returns a broad/specific
   * parse result, not `{ exam }`). Use {@link masteryAPI.parse} instead. Signature
   * unchanged for existing consumers.
   */
  parseExam(
    client: ApiClient,
    payload: ParseExamPayload,
  ): Promise<ApiResult<ParseExamResponse>> {
    return client.post<ParseExamResponse>("/api/mastery/parse", payload);
  },

  /**
   * POST /api/mastery/parse — correctly-typed parse. Returns the broad/specific
   * discriminated union. Re-POST with refined input on `scope: "broad"`; on
   * `scope: "specific"` pass the result to `createExamFromParse`.
   */
  parse(
    client: ApiClient,
    payload: ParseExamPayload,
  ): Promise<ApiResult<MasteryParseResponse>> {
    return client.post<MasteryParseResponse>("/api/mastery/parse", payload);
  },

  /**
   * POST /api/mastery/exams — create a user_exam + its subtopics from a
   * "specific" parse result. Success: `{ examId }`. At the plan cap the route
   * returns 403 with a {@link MasteryPlanLimitError} body — check
   * `isMasteryPlanLimit(r.data)` when `!r.ok && r.status === 403`.
   */
  createExamFromParse(
    client: ApiClient,
    payload: CreateExamFromParsePayload,
  ): Promise<ApiResult<CreateExamFromParseResponse | MasteryPlanLimitError>> {
    return client.post<CreateExamFromParseResponse | MasteryPlanLimitError>(
      "/api/mastery/exams",
      payload,
    );
  },

  /** GET /api/mastery/exams — the caller's non-archived mastery targets with progress summary. */
  listExams(
    client: ApiClient,
  ): Promise<ApiResult<{ exams: MasteryExamSummary[] }>> {
    return client.get<{ exams: MasteryExamSummary[] }>("/api/mastery/exams");
  },

  /**
   * POST /api/mastery/sessions/[id]/heartbeat — credit active study seconds.
   * `seconds` is clamped 1..15 server-side; the client sends ~10 per beacon.
   * No-ops (credited: 0) on non-active sessions.
   */
  heartbeat(
    client: ApiClient,
    sessionId: string,
    seconds: number,
  ): Promise<ApiResult<{ ok: true; credited: number }>> {
    return client.post<{ ok: true; credited: number }>(
      `/api/mastery/sessions/${sessionId}/heartbeat`,
      { deltaSeconds: seconds },
    );
  },

  /** GET /api/mastery/sessions/[id]/state — refresh-resumable scratch state (null if none saved). */
  getState(
    client: ApiClient,
    sessionId: string,
  ): Promise<ApiResult<{ state: MasterySessionScratchState | null }>> {
    return client.get<{ state: MasterySessionScratchState | null }>(
      `/api/mastery/sessions/${sessionId}/state`,
    );
  },

  /** POST /api/mastery/sessions/[id]/state — debounced autosave of the scratch state. */
  saveState(
    client: ApiClient,
    sessionId: string,
    payload: SaveMasteryStatePayload,
  ): Promise<ApiResult<{ ok: true }>> {
    return client.post<{ ok: true }>(
      `/api/mastery/sessions/${sessionId}/state`,
      payload,
    );
  },

  /**
   * POST /api/mastery/sessions/[id]/prefetch — stage warm questions for the
   * client queue. Does NOT mutate pending state; submit a staged question's
   * id as `preferredQuestionId` to /next to make it live.
   */
  prefetch(
    client: ApiClient,
    sessionId: string,
    options: MasteryPrefetchOptions = {},
  ): Promise<ApiResult<{ questions: MasteryPrefetchedQuestion[] }>> {
    return client.post<{ questions: MasteryPrefetchedQuestion[] }>(
      `/api/mastery/sessions/${sessionId}/prefetch`,
      options,
    );
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

  /**
   * POST /api/mastery/sessions/[id]/socratic — submit the user's text reply
   * to a socratic prompt. Server evaluates against the expected concept and
   * either accepts (advance), redirects (clarifying question), or asks again.
   */
  submitSocratic(
    client: ApiClient,
    sessionId: string,
    reply: string,
  ): Promise<ApiResult<unknown>> {
    return client.post(`/api/mastery/sessions/${sessionId}/socratic`, { reply });
  },
} as const;
