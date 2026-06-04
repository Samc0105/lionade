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

// Strokes need their OWN topic. SketchView already subscribes to the main
// sketch channel for game-state events (ROUND_STARTED, GUESS, etc.). If
// SketchCanvas ALSO subscribes to the same topic for strokes, Supabase's
// JS client treats them as conflicting same-topic subscriptions from one
// tab — sends silently drop and event delivery becomes inconsistent.
// Drawer sees their own local paint, guessers see nothing. This separate
// topic decouples the high-frequency stroke flood from the slower-paced
// game-state events. See SketchCanvas.tsx for the subscriber.
export function sketchStrokesChannel(code: string): string {
  return `party-room-${code}-sketch-strokes`;
}

export function bluffChannel(code: string): string {
  return `party-room-${code}-bluff`;
}

export function pokerFaceChannel(code: string): string {
  return `party-room-${code}-pokerface`;
}

// Separate channel for lobby-only ephemeral fun (the "hurry up" nudges) — kept
// off the main room channel so its handlers don't tangle with the room-state
// lifecycle on (un)mount.
export function nudgeChannel(code: string): string {
  return `party-room-${code}-nudge`;
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
  // Lobby flavor: a non-host taps the rotating "nudge" button. Payload carries
  // the random phrase + sender's name; everyone in the room sees the toast.
  HOST_NUDGE: "host_nudge",
} as const;

export const SKETCH_EVENTS = {
  ROUND_STARTED: "round_started",
  WORD_SELECTED: "word_selected",
  STROKE: "stroke",
  CLEAR_CANVAS: "clear_canvas",
  GUESS: "guess",
  // Progressive Wordle reveal: a guess matched new letter POSITIONS. Payload
  // carries only matched positions + their letters (never the secret word), so
  // every client lights up the shared green squares in real time.
  LETTER_REVEAL: "letter_reveal",
  ROUND_ENDED: "round_ended",
} as const;

export const BLUFF_EVENTS = {
  ROUND_STARTED: "round_started",
  PHASE_CHANGED: "phase_changed",
  ANSWER_SUBMITTED: "answer_submitted",
  VOTE_SUBMITTED: "vote_submitted",
  ROUND_ENDED: "round_ended",
} as const;

export const POKERFACE_EVENTS = {
  ROUND_STARTED: "round_started",   // a fresh round was dealt (new presenter)
  PRESENTED: "presented",           // presenter committed truth/lie + claim
  PHASE_CHANGED: "phase_changed",   // present -> vote -> reveal
  CALL_SUBMITTED: "call_submitted", // a caller called believe/doubt
  ROUND_ENDED: "round_ended",       // reveal + score
} as const;
