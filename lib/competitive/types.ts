// Competitive platform — shared types across all 5 modes and both formats.

export type CompetitiveMode =
  | "sabotage"
  | "zoom"
  | "spectrum"
  | "pin"
  | "pokerface";

export type CompetitiveFormat = "1v1" | "2v2";

export type MatchStatus = "queued" | "active" | "completed";

export type WinnerTeam = "a" | "b" | "draw" | null;

export const COMPETITIVE_MODES: CompetitiveMode[] = [
  "sabotage",
  "zoom",
  "spectrum",
  "pin",
  "pokerface",
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
  created_at: string;
  completed_at: string | null;
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
