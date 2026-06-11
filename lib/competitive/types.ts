// Competitive platform — shared types across all 4 modes and both formats.
//
// Poker Face was MOVED to Lionade Party (Arcade) on 2026-05-28 as a no-ELO,
// no-Fang social party game; the competitive arena is now 4 modes. See
// project_competitive_modes.md + project_lionade_party.md.

export type CompetitiveMode =
  | "sabotage"
  | "zoom"
  | "spectrum"
  | "pin";

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
  return (
    typeof v === "string" &&
    (COMPETITIVE_MODES as string[]).includes(v)
  );
}

export function isFormat(v: unknown): v is CompetitiveFormat {
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
  // Server-anchored round START (migration 059). The single wall-clock instant
  // both clients anchor the pre-round 3-2-1-GO + round 1's clock to, killing the
  // clock-skew head start. NULL on pre-migration rows → screens fall back to the
  // local countdown sequence. Not a secret — served in the match payload.
  starts_at: string | null;
  created_at: string;
  completed_at: string | null;
}

/** Terminal statuses — a match in any of these has finished settling. */
export const TERMINAL_STATUSES: MatchStatus[] = ["completed", "voided", "forfeited"];

export function isTerminalStatus(s: string): boolean {
  return (TERMINAL_STATUSES as string[]).includes(s);
}

/** Per-user final score the completion endpoint receives from a mode screen. */
export interface ModeScoreSubmission {
  /** user_id -> raw score (mode-specific scale). Higher = better. */
  scores: Record<string, number>;
}

/** Which ELO column a format writes. */
export function eloColumnForFormat(format: CompetitiveFormat): "competitive_elo" | "squad_elo" {
  return format === "2v2" ? "squad_elo" : "competitive_elo";
}
