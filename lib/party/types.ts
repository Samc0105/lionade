// Shared types for Lionade Party API + UI.

export type RoomStatus = "lobby" | "playing" | "ended";
export type CurrentGame = "sketch" | "bluff" | null;

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
}

export interface PartyPlayer {
  user_id: string;
  username: string | null;
  score: number;
  joined_at: string;
  left_at: string | null;
  is_ready: boolean;
  selected_subjects: string[];   // up to 2 topic picks for sketch weighting
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
