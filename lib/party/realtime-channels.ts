// Realtime channel name helpers for Lionade Party.
//
// One main room channel + one per-game channel. Keeping per-game channels
// separate lets the bluff phase events not interleave with sketch stroke
// floods (which can hit 30Hz during active drawing).

export function roomChannel(code: string): string {
  return `party-room-${code}`;
}

export function sketchChannel(code: string): string {
  return `party-room-${code}-sketch`;
}

export function bluffChannel(code: string): string {
  return `party-room-${code}-bluff`;
}

// ── Event name constants ──
// Keep these centralized so the client and server send/listen for the same
// strings. Realtime broadcast events are case-sensitive.

export const PARTY_EVENTS = {
  PLAYER_JOINED: "player_joined",
  PLAYER_LEFT: "player_left",
  GAME_STARTED: "game_started",
  GAME_ENDED: "game_ended",
  ROOM_UPDATED: "room_updated",
} as const;

export const SKETCH_EVENTS = {
  ROUND_STARTED: "round_started",
  WORD_SELECTED: "word_selected",
  STROKE: "stroke",
  CLEAR_CANVAS: "clear_canvas",
  GUESS: "guess",
  ROUND_ENDED: "round_ended",
} as const;

export const BLUFF_EVENTS = {
  ROUND_STARTED: "round_started",
  PHASE_CHANGED: "phase_changed",
  ANSWER_SUBMITTED: "answer_submitted",
  VOTE_SUBMITTED: "vote_submitted",
  ROUND_ENDED: "round_ended",
} as const;
