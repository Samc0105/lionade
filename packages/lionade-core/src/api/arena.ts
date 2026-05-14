/**
 * Arena API — 1v1 PvP matchmaking, real-time match flow, ELO ladder.
 *
 * Five endpoints, one cohesive flow:
 *
 *   1. POST   /api/arena/queue       → join the matchmaking queue (wager 10/25/50/100 F)
 *   2. GET    /api/arena/queue       → poll for match (server returns "matched" + matchId
 *                                       when an opponent in your ELO band is found)
 *   3. DELETE /api/arena/queue       → leave the queue (Cancel Search)
 *   4. GET    /api/arena/match?id=…  → fetch full match snapshot (questions, players,
 *                                       answers, score). Questions ship WITHOUT correct
 *                                       answers — anti-cheat.
 *   5. PATCH  /api/arena/match       → state transitions (`action: "start"` flips
 *                                       pending → active)
 *   6. POST   /api/arena/answer      → submit your answer for a question; server
 *                                       validates correctness + speed bonus.
 *   7. POST   /api/arena/complete    → finalize: ELO Elo K=32 update, Fang transfer,
 *                                       win/loss/draw counters. Idempotent via the
 *                                       active → completing claim.
 *   8. POST   /api/arena/challenge   → invite a specific friend (no queue)
 *   9. GET    /api/arena/challenge   → poll for incoming + accepted challenges
 *   10. PATCH /api/arena/challenge   → accept or decline an incoming challenge
 *
 * The server is the source of truth for correctness, points, scores, ELO,
 * and Fang balance. The client renders the match and POSTs answer indices —
 * never the "I was correct" flag, never the points earned. That keeps the
 * ladder safe even if someone patches the iOS bundle.
 *
 * Usage:
 *   import { arenaAPI } from "@lionade/core/api/arena";
 *   const join = await arenaAPI.joinQueue(apiClient, { wager: 25 });
 *   const poll = await arenaAPI.pollQueue(apiClient);
 *   if (poll.data?.status === "matched") {
 *     const match = await arenaAPI.getMatch(apiClient, poll.data.matchId!);
 *   }
 */

import type { ApiClient, ApiResult } from "./http.js";

// ── Domain types (shape mirrors what the server returns) ────────────────────

export interface ArenaQueueEntry {
  id: string;
  user_id: string;
  elo_rating: number;
  wager: number;
  status: "waiting" | "matched" | "cancelled" | string;
  joined_at: string;
  match_id: string | null;
}

export interface ArenaJoinQueueResponse {
  queueEntry: ArenaQueueEntry;
}

/**
 * Polling response — three possible states.
 *
 * - `waiting`: still searching. `eloRange` grows after 30s (200 → 500).
 *              `waitMs` is the server-clock duration we've been in queue.
 * - `matched`: opponent locked, match row created, server is judging
 *              question time limits. `matchId` is set.
 * - `not_in_queue`: queue entry was cancelled or already consumed.
 */
export interface ArenaQueuePollResponse {
  status: "waiting" | "matched" | "not_in_queue" | string;
  matchId?: string;
  eloRange?: number;
  waitMs?: number;
  /** Server may include this when not enough questions are available to start a match. */
  note?: string;
}

export interface ArenaPlayer {
  id: string;
  username: string | null;
  avatarUrl: string | null;
  elo: number;
}

export interface ArenaMatchQuestion {
  id: string;
  order: number;
  question: string;
  options: string[];
  difficulty: string;
  subject: string;
  /** Per-question time limit set by the judge (seconds). */
  timeLimit: number;
  /** Heuristic tag: "recall" | "calculation" | "reasoning". */
  cognitiveLoad: string;
}

export interface ArenaMatchMeta {
  id: string;
  status: "pending" | "active" | "completing" | "completed" | "cancelled" | string;
  wager: number;
  currentQuestion: number;
  player1Score: number;
  player2Score: number;
  winnerId: string | null;
  player1EloBefore: number;
  player2EloBefore: number;
  player1EloAfter: number | null;
  player2EloAfter: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ArenaAnswerRow {
  question_id: string;
  user_id: string;
  is_correct: boolean;
  response_time_ms: number;
  points_earned: number;
  selected_answer: number | null;
}

/**
 * Per-question map of "who's answered what so far." Keyed by question_id;
 * each value has up-to-two answers (player1 and/or player2). The polling
 * fallback for slow-opponent uses this to detect bothAnswered.
 */
export type ArenaAnswerMap = Record<
  string,
  { player1?: ArenaAnswerRow; player2?: ArenaAnswerRow }
>;

export interface ArenaMatch {
  match: ArenaMatchMeta;
  player1: ArenaPlayer | null;
  player2: ArenaPlayer | null;
  questions: ArenaMatchQuestion[];
  answers: ArenaAnswerMap;
}

// ── Answer submission ────────────────────────────────────────────────────────

export interface ArenaAnswerPayload {
  matchId: string;
  questionId: string;
  /** Index of selected option, or -1 if the timer ran out (no choice). */
  selectedAnswer: number;
  /** Client-measured response time in ms; server clamps to [500, timeLimit*1000]. */
  responseTimeMs: number;
}

export interface ArenaOpponentAnswer {
  is_correct: boolean;
  points_earned: number;
  selected_answer: number;
  response_time_ms: number;
}

export interface ArenaAnswerResponse {
  isCorrect: boolean;
  /** Server-truth correct option index. Use this to render the reveal state. */
  correctAnswer: number;
  explanation: string | null;
  /** 10 base + 0/1/3/5 speed bonus (faster = more). 0 if wrong/timeout. */
  pointsEarned: number;
  /** True if both players have now answered this question (i.e., we can advance). */
  bothAnswered: boolean;
  /** Opponent's answer if they've already submitted, else null. */
  opponentAnswer: ArenaOpponentAnswer | null;
}

// ── Match completion ─────────────────────────────────────────────────────────

export interface ArenaPlayerResult {
  points: number;
  correct: number;
  eloBefore: number;
  eloAfter: number;
  eloChange: number;
}

export interface ArenaCompletePayload {
  matchId: string;
}

export interface ArenaCompleteResponse {
  winnerId: string | null;
  isDraw: boolean;
  player1: ArenaPlayerResult;
  player2: ArenaPlayerResult;
  wager: number;
  /** Set when the match was already finalized by the other player's client. */
  alreadyCompleted?: boolean;
  /** Present alongside alreadyCompleted when re-fetching the canonical row. */
  match?: unknown;
}

// ── Match PATCH (start) ──────────────────────────────────────────────────────

export type ArenaMatchAction = "start";

export interface ArenaMatchPatchPayload {
  matchId: string;
  action: ArenaMatchAction;
}

export interface ArenaMatchPatchResponse {
  success: boolean;
}

// ── Friend challenges ────────────────────────────────────────────────────────

export interface ArenaChallengeRow {
  id: string;
  challenger_id: string;
  challenged_id: string;
  wager: number;
  status: "pending" | "accepted" | "declined" | "expired" | string;
  match_id: string | null;
  created_at: string;
  expires_at: string;
}

export interface ArenaChallengePayload {
  /** Target username — server lower-cases + validates `[a-z0-9_]{3,20}`. */
  challengedUsername: string;
  /** One of 10 / 25 / 50 / 100. Server falls back to 10 if invalid. */
  wager: number;
}

export interface ArenaChallengeResponse {
  challenge: ArenaChallengeRow;
  challengedUser: { id: string; username: string };
}

export interface ArenaIncomingChallenge {
  id: string;
  challengerId: string;
  challengerName: string;
  challengerAvatar: string | null;
  challengerElo: number;
  wager: number;
  createdAt: string;
  expiresAt: string;
}

export interface ArenaChallengesListResponse {
  challenges: ArenaIncomingChallenge[];
  /** Most-recent challenge I sent that just got accepted — kicks me into the match. */
  acceptedChallenge: { id: string; matchId: string } | null;
}

export type ArenaChallengeAction = "accept" | "decline";

export interface ArenaChallengeActionPayload {
  challengeId: string;
  action: ArenaChallengeAction;
}

export interface ArenaChallengeActionResponse {
  success: boolean;
  status: "accepted" | "declined" | string;
  /** Present when action="accept" — the freshly-created match to drop into. */
  matchId?: string;
}

// ── Methods ──────────────────────────────────────────────────────────────────

export const arenaAPI = {
  /**
   * POST /api/arena/queue — join the matchmaking queue.
   *
   * Server validates the wager (10/25/50/100, falls back to 10) and refuses
   * if the user doesn't have enough Fangs. Any existing waiting row for this
   * user is replaced.
   */
  joinQueue(
    client: ApiClient,
    payload: { wager: number },
  ): Promise<ApiResult<ArenaJoinQueueResponse>> {
    return client.post<ArenaJoinQueueResponse>("/api/arena/queue", payload);
  },

  /**
   * GET /api/arena/queue — poll for match status.
   *
   * Call this on a 2-second interval after joinQueue. When `status === "matched"`,
   * stop polling and follow up with getMatch(matchId) to load the questions.
   */
  pollQueue(client: ApiClient): Promise<ApiResult<ArenaQueuePollResponse>> {
    return client.get<ArenaQueuePollResponse>("/api/arena/queue");
  },

  /**
   * DELETE /api/arena/queue — leave the queue.
   *
   * Safe to call whether or not we're actually queued; server is idempotent.
   */
  leaveQueue(client: ApiClient): Promise<ApiResult<{ success: true }>> {
    return client.delete<{ success: true }>("/api/arena/queue");
  },

  /**
   * GET /api/arena/match?id=… — load the full match snapshot.
   *
   * Questions arrive WITHOUT correct_answer (anti-cheat). To learn the right
   * choice you must POST to /api/arena/answer.
   */
  getMatch(client: ApiClient, matchId: string): Promise<ApiResult<ArenaMatch>> {
    return client.get<ArenaMatch>(`/api/arena/match?id=${encodeURIComponent(matchId)}`);
  },

  /**
   * PATCH /api/arena/match — state transitions.
   *
   * Currently only `action: "start"` is supported; flips status pending → active
   * and stamps `started_at`. Both clients can fire this safely; the server's
   * `.in("status", ["pending"])` guard prevents double-starts.
   */
  startMatch(
    client: ApiClient,
    matchId: string,
  ): Promise<ApiResult<ArenaMatchPatchResponse>> {
    return client.patch<ArenaMatchPatchResponse>("/api/arena/match", {
      matchId,
      action: "start" satisfies ArenaMatchAction,
    });
  },

  /**
   * POST /api/arena/answer — submit my answer for a question.
   *
   * Server-validates correctness (against the DB, not the client), clamps
   * response time to [500ms, timeLimit*1000ms], calculates speed-bonus
   * points (0/1/3/5 on top of 10 base if correct).
   *
   * Pass `selectedAnswer: -1` for timer-expired no-pick — counts as wrong.
   */
  submitAnswer(
    client: ApiClient,
    payload: ArenaAnswerPayload,
  ): Promise<ApiResult<ArenaAnswerResponse>> {
    return client.post<ArenaAnswerResponse>("/api/arena/answer", payload);
  },

  /**
   * POST /api/arena/complete — finalize the match.
   *
   * Computes winner from accumulated answer points, runs Elo K=32 update,
   * transfers Fangs (winner += wager, loser -= wager, clamped ≥ 0), bumps
   * win/loss/draw counters. Both clients can call this safely; the
   * active → completing claim ensures the Fang transfer runs exactly once.
   */
  completeMatch(
    client: ApiClient,
    payload: ArenaCompletePayload,
  ): Promise<ApiResult<ArenaCompleteResponse>> {
    return client.post<ArenaCompleteResponse>("/api/arena/complete", payload);
  },

  /**
   * POST /api/arena/challenge — challenge a friend by username.
   *
   * Server checks both players have enough Fangs and cancels any prior
   * pending challenge from this user. Drops a notification into the
   * recipient's `notifications` table (best-effort).
   */
  challengeFriend(
    client: ApiClient,
    payload: ArenaChallengePayload,
  ): Promise<ApiResult<ArenaChallengeResponse>> {
    return client.post<ArenaChallengeResponse>("/api/arena/challenge", payload);
  },

  /**
   * GET /api/arena/challenge — poll for incoming + freshly-accepted challenges.
   *
   * Returns my pending incoming challenges (where I'm the challenged) plus
   * the most recent challenge I sent that's now `accepted` (so the sender's
   * client can transition into the match without a separate notification path).
   */
  listChallenges(
    client: ApiClient,
  ): Promise<ApiResult<ArenaChallengesListResponse>> {
    return client.get<ArenaChallengesListResponse>("/api/arena/challenge");
  },

  /**
   * PATCH /api/arena/challenge — accept or decline an incoming challenge.
   *
   * Accept creates a fresh arena_matches row + judge data and returns the
   * new matchId so the accepting client can load straight into prematch.
   */
  respondToChallenge(
    client: ApiClient,
    payload: ArenaChallengeActionPayload,
  ): Promise<ApiResult<ArenaChallengeActionResponse>> {
    return client.patch<ArenaChallengeActionResponse>(
      "/api/arena/challenge",
      payload,
    );
  },
} as const;
