/**
 * Competitive platform API — matchmaking queue, match state, server-scored
 * answers, completion/forfeit settlement, and the sabotage attack channel.
 *
 * Wraps the platform-neutral routes:
 *   POST   /api/competitive/queue                 → join (immediate match attempt)
 *   GET    /api/competitive/queue                 → poll for a match
 *   DELETE /api/competitive/queue                 → leave the queue
 *   GET    /api/competitive/match/[id]            → match + sanitized rounds + players
 *   POST   /api/competitive/match/[id]/answer     → submit a raw answer (server scores)
 *   POST   /api/competitive/match/[id]/complete   → settle (server-authoritative)
 *   POST   /api/competitive/match/[id]/forfeit    → concede
 *   POST   /api/competitive/sabotage/attack       → durable sabotage attack record
 *
 * Type shapes are COPIED from web's lib/competitive/types.ts (core must not
 * import from web lib). Keep them in lock-step — the route handlers are the
 * runtime source of truth.
 *
 * SECRET STRIPPING: rounds in the GET match payload have their secret columns
 * (correct_index / answer / aliases / true_value / true_lat,lng) removed until
 * the round has ended. The secret reaches a client only through the /answer
 * reveal, after that player acts.
 */

import type { ApiClient, ApiResult } from "./http.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mode / match types (copied from lib/competitive/types.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type CompetitiveMode = "sabotage" | "zoom" | "spectrum" | "pin";

export type CompetitiveFormat = "1v1" | "2v2";

export type MatchStatus =
  | "queued"
  | "active"
  | "completing"
  | "completed"
  | "voided"
  | "forfeited";

export type WinnerTeam = "a" | "b" | "draw" | null;

export const COMPETITIVE_MODES: CompetitiveMode[] = [
  "sabotage",
  "zoom",
  "spectrum",
  "pin",
];

export function isCompetitiveMode(v: unknown): v is CompetitiveMode {
  return typeof v === "string" && (COMPETITIVE_MODES as string[]).includes(v);
}

export function isCompetitiveFormat(v: unknown): v is CompetitiveFormat {
  return v === "1v1" || v === "2v2";
}

export interface CompetitiveMatchRow {
  id: string;
  mode: CompetitiveMode;
  format: CompetitiveFormat;
  status: MatchStatus;
  team_a: string[];
  team_b: string[];
  winner_team: WinnerTeam;
  elo_before: Record<string, number>;
  elo_after: Record<string, number>;
  fang_delta: Record<string, number>;
  wager: number;
  forfeited_by: string | null;
  /**
   * Server-anchored round START. The single wall-clock instant both clients
   * anchor the pre-round 3-2-1-GO + round 1's clock to. NULL on pre-migration
   * rows → screens fall back to the local countdown sequence.
   */
  starts_at: string | null;
  created_at: string;
  completed_at: string | null;
}

/** Terminal statuses — a match in any of these has finished settling. */
export const COMPETITIVE_TERMINAL_STATUSES: MatchStatus[] = [
  "completed",
  "voided",
  "forfeited",
];

export function isTerminalMatchStatus(s: string): boolean {
  return (COMPETITIVE_TERMINAL_STATUSES as string[]).includes(s);
}

/** Which ELO column a format writes. */
export function eloColumnForFormat(
  format: CompetitiveFormat,
): "competitive_elo" | "squad_elo" {
  return format === "2v2" ? "squad_elo" : "competitive_elo";
}

/** Sabotage attack kinds (copied from lib/competitive/channels.ts). */
export type SabotageAttackKind =
  | "blur"
  | "scramble"
  | "drain"
  | "decoy"
  | "freeze"
  | "fog";

// ─────────────────────────────────────────────────────────────────────────────
// Queue
// ─────────────────────────────────────────────────────────────────────────────

export interface JoinQueuePayload {
  /** Default '1v1' server-side. */
  format?: CompetitiveFormat;
  /** Mode preference; server resolves agreement between both players. */
  mode?: CompetitiveMode | null;
  /** Party room code for friends-queue grouping. */
  partyCode?: string;
}

export type QueueJoinResponse =
  | { status: "matched"; matchId: string }
  | { status: "waiting" };

export type QueuePollResponse =
  | { status: "matched"; matchId: string }
  | { status: "waiting" }
  | { status: "not_queued" };

// ─────────────────────────────────────────────────────────────────────────────
// Match payloads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A round row from the mode's round table (sabotage_rounds / zoom_rounds /
 * spectrum_rounds / pin_rounds). Columns are mode-specific; the secret
 * columns are STRIPPED until ended_at is set, so they're typed as optional
 * unknowns via the index signature.
 */
export interface CompetitiveRound {
  id: string;
  match_id: string;
  round_num: number;
  ended_at: string | null;
  [column: string]: unknown;
}

export interface CompetitivePlayer {
  id: string;
  username: string | null;
  avatar_url: string | null;
  competitive_elo: number | null;
  squad_elo: number | null;
}

export interface CompetitiveMatchResponse {
  match: CompetitiveMatchRow;
  rounds: CompetitiveRound[];
  players: CompetitivePlayer[];
  /** The caller's user id — saves the client a session lookup. */
  you: string;
}

// ── Answer submission (mode-specific raw answers — never scores) ───────────

export interface SabotageAnswerPayload {
  roundNum: number;
  /** Selected option index. */
  index: number;
}

export interface ZoomAnswerPayload {
  roundNum: number;
  guess: string;
  elapsedMs: number;
}

export interface SpectrumAnswerPayload {
  roundNum: number;
  guess: number;
}

export interface PinAnswerPayload {
  roundNum: number;
  lat: number;
  lng: number;
}

export type CompetitiveAnswerPayload =
  | SabotageAnswerPayload
  | ZoomAnswerPayload
  | SpectrumAnswerPayload
  | PinAnswerPayload;

/**
 * The reveal is the just-answered round's secret, shaped per mode:
 *   sabotage: { correct_index }   zoom: { answer }
 *   spectrum: { true_value }      pin: { true_lat, true_lng }
 */
export interface CompetitiveAnswerResponse {
  points: number;
  isCorrect: boolean;
  reveal: Record<string, unknown>;
  /** Present (true) when this user already had a scored response for the round. */
  alreadyAnswered?: boolean;
}

// ── Completion / forfeit ────────────────────────────────────────────────────

/** Returned when the match was already terminal — the settled row comes back. */
export interface AlreadyCompletedResponse {
  alreadyCompleted: true;
  match: CompetitiveMatchRow;
}

/** Engagement gate fired — no real contest, no ELO/Fang movement. */
export interface MatchVoidedResponse {
  matchId: string;
  voided: true;
  reason: string;
  winnerTeam: null;
  scoreA: number;
  scoreB: number;
  mode: CompetitiveMode;
  format: CompetitiveFormat;
}

export interface MatchSettledResponse {
  matchId: string;
  winnerTeam: "a" | "b" | "draw";
  scoreA: number;
  scoreB: number;
  eloBefore: Record<string, number>;
  eloAfter: Record<string, number>;
  eloDeltas: Record<string, number>;
  fangDelta: Record<string, number>;
  mode: CompetitiveMode;
  format: CompetitiveFormat;
}

export type CompleteMatchResponse =
  | AlreadyCompletedResponse
  | MatchVoidedResponse
  | MatchSettledResponse;

export interface ForfeitVoidedResponse {
  ok: true;
  voided: true;
  reason: string;
  result: { winnerTeam: null; scoreA: number; scoreB: number };
  mode: CompetitiveMode;
  format: CompetitiveFormat;
}

export interface ForfeitSettledResponse {
  ok: true;
  forfeited: true;
  result: {
    winnerTeam: "a" | "b" | "draw";
    scoreA: number;
    scoreB: number;
    eloBefore: Record<string, number>;
    eloAfter: Record<string, number>;
    eloDeltas: Record<string, number>;
    fangDelta: Record<string, number>;
  };
  mode: CompetitiveMode;
  format: CompetitiveFormat;
}

export type ForfeitMatchResponse =
  | AlreadyCompletedResponse
  | ForfeitVoidedResponse
  | ForfeitSettledResponse;

export interface SabotageAttackPayload {
  matchId: string;
  /** Must be on the OPPOSING team. */
  targetId: string;
  kind: SabotageAttackKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// Methods
// ─────────────────────────────────────────────────────────────────────────────

export const competitiveAPI = {
  /** POST /api/competitive/queue — join and attempt an immediate match. */
  joinQueue(
    client: ApiClient,
    payload: JoinQueuePayload = {},
  ): Promise<ApiResult<QueueJoinResponse>> {
    return client.post<QueueJoinResponse>("/api/competitive/queue", payload);
  },

  /** GET /api/competitive/queue — poll: matched yet? Re-runs the matcher server-side. */
  pollQueue(client: ApiClient): Promise<ApiResult<QueuePollResponse>> {
    return client.get<QueuePollResponse>("/api/competitive/queue");
  },

  /** DELETE /api/competitive/queue — leave (no-op if already matched). */
  leaveQueue(client: ApiClient): Promise<ApiResult<{ ok: true }>> {
    return client.delete<{ ok: true }>("/api/competitive/queue");
  },

  /**
   * GET /api/competitive/match/[id] — full match state for a participant
   * (403 for non-participants). Round secrets are stripped until each round
   * ends.
   */
  getMatch(
    client: ApiClient,
    matchId: string,
  ): Promise<ApiResult<CompetitiveMatchResponse>> {
    return client.get<CompetitiveMatchResponse>(
      `/api/competitive/match/${matchId}`,
    );
  },

  /**
   * POST /api/competitive/match/[id]/answer — submit the RAW answer for one
   * round; the server scores it against the secret and returns the reveal.
   * Idempotent per (match, round, user) — a resubmit returns the original
   * score with `alreadyAnswered: true`.
   */
  submitAnswer(
    client: ApiClient,
    matchId: string,
    payload: CompetitiveAnswerPayload,
  ): Promise<ApiResult<CompetitiveAnswerResponse>> {
    return client.post<CompetitiveAnswerResponse>(
      `/api/competitive/match/${matchId}/answer`,
      payload,
    );
  },

  /**
   * POST /api/competitive/match/[id]/complete — settle the match. The body is
   * ignored for scoring; the outcome is recomputed server-side from
   * competitive_responses. May come back voided (engagement gate) or as the
   * already-settled row.
   */
  completeMatch(
    client: ApiClient,
    matchId: string,
  ): Promise<ApiResult<CompleteMatchResponse>> {
    return client.post<CompleteMatchResponse>(
      `/api/competitive/match/${matchId}/complete`,
      {},
    );
  },

  /**
   * POST /api/competitive/match/[id]/forfeit — concede. The caller's team
   * takes the loss when a real contest happened; voids (no penalty) when the
   * opponent never engaged.
   */
  forfeitMatch(
    client: ApiClient,
    matchId: string,
  ): Promise<ApiResult<ForfeitMatchResponse>> {
    return client.post<ForfeitMatchResponse>(
      `/api/competitive/match/${matchId}/forfeit`,
      {},
    );
  },

  /**
   * POST /api/competitive/sabotage/attack — durable audit row for a sabotage
   * attack. The LIVE attack is delivered peer-to-peer via the realtime match
   * channel (platform-specific wiring); this records + validates it.
   */
  sendSabotageAttack(
    client: ApiClient,
    payload: SabotageAttackPayload,
  ): Promise<ApiResult<{ ok: true }>> {
    return client.post<{ ok: true }>(
      "/api/competitive/sabotage/attack",
      payload,
    );
  },
} as const;
