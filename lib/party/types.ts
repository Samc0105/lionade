// Shared types for Lionade Party API + UI.

export type RoomStatus = "lobby" | "playing" | "ended";
export type CurrentGame = "sketch" | "bluff" | "pokerface" | null;

export interface PartyRoom {
  id: string;
  code: string;
  host_user_id: string;
  status: RoomStatus;
  current_game: CurrentGame;
  settings: PartySettings;
  created_at: string;
  ended_at: string | null;
}

export interface PartySettings {
  subjects?: string[];          // sketch: which subject pools are enabled
  rounds_per_player?: number;   // sketch: default 2
  bluff_round_count?: number;   // bluff: default 5
  write_seconds?: number;       // bluff: default 45
  vote_seconds?: number;        // bluff: default 30
  pf_vote_seconds?: number;     // pokerface: default 30 (caller call window)
  pf_rotations?: number;        // pokerface: full presenter rotations per game, default 2
  pf_mode?: "inperson" | "remote"; // pokerface: spoken (default) vs typed-claim
  pf_player_count?: number;     // pokerface: player count frozen at game start (stable game length)
}

export interface PartyPlayer {
  user_id: string;
  username: string | null;
  score: number;
  joined_at: string;
  left_at: string | null;
  is_ready: boolean;
  selected_subjects: string[];   // up to 2 topic picks for sketch weighting
  // Shop V2 — optional, server-supplied. Used by AnimatedUsername in lobby /
  // scoreboard tiles. Null/missing = no effect (free user).
  equipped_username_effect?: string | null;
}

export interface PartyRoomState {
  room: PartyRoom;
  players: PartyPlayer[];
  isHost: boolean;
  meUserId: string;
}

export interface SketchRound {
  id: string;
  room_id: string;
  round_num: number;
  drawer_user_id: string;
  word: string | null;        // null = drawer hasn't picked yet (only revealed to drawer)
  subject: string;
  factoid: string | null;
  duration_sec: number;
  started_at: string;
  ended_at: string | null;
}

export interface SketchStrokePayload {
  stroke_num: number;
  color: string;
  size: number;
  points: number[][];   // compact [[x,y],[x,y],...]
}

export interface SketchGuess {
  id: number;
  user_id: string;
  username?: string | null;
  guess: string;       // redacted to "Got it!" if was_correct, "Close!" if was_close
  was_correct: boolean;
  was_close: boolean;
  points_earned: number;
  guessed_at: string;
}

export interface BluffRound {
  id: string;
  room_id: string;
  round_num: number;
  question: string;
  category: string | null;
  phase: "write" | "vote" | "reveal";
  started_at: string;
  write_ends_at: string | null;
  vote_ends_at: string | null;
  ended_at: string | null;
}

export interface BluffAnswerPublic {
  id: string;
  text: string;
  // We hide author + is_truth until reveal phase. The server filters these.
  author_user_id?: string;
  is_truth?: boolean;
}

// 'interrogate' is a live-mode-only beat between present and vote: one caller
// grills the presenter with a question before calls open. Text mode skips it.
export type PokerFacePhase = "present" | "interrogate" | "vote" | "reveal";
export type PokerFaceCall = "believe" | "doubt";

// Phase-aware Poker Face round view. The server NEVER ships card_fact / is_lie /
// claim_text to a non-presenter before reveal (the secrets that decide the
// bluff). Fields below are present only in the phase that's allowed to see them.
export interface PokerFaceRoundView {
  id: string;
  room_id: string;
  round_num: number;
  presenter_user_id: string;
  presenter_username: string | null;
  card_word: string;            // shown to everyone (not secret)
  phase: PokerFacePhase;
  started_at: string;
  presented_at: string | null;
  ended_at: string | null;
  // Caller-visible only from phase='vote' onward: what the presenter chose to
  // show (truth shown verbatim, or their invented lie). Never reveals is_lie.
  claim_text?: string | null;
  // Presenter-only convenience (the server gates this to the presenter): the
  // true fact + whether they marked it a lie, so their own screen can render.
  card_fact?: string | null;
  is_lie?: boolean | null;
  // Per-viewer state.
  my_call?: PokerFaceCall | null;
  call_count?: number;          // how many callers have called so far
  caller_count?: number;        // how many non-presenters are in the room
  // Reveal-only.
  reveal?: {
    is_lie: boolean;
    card_fact: string;
    claim_text: string;
    calls: { user_id: string; username: string | null; call: PokerFaceCall; correct: boolean }[];
    round_points: Record<string, number>;  // per-user points earned this round
  };
}
