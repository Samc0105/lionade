// Realtime channel name helpers for Lionade Party.
//
// One main room channel + one per-game channel. Keeping per-game channels
// separate lets the bluff phase events not interleave with sketch stroke
// floods (which can hit 30Hz during active drawing).

export function roomChannel(code: string): string {
  return `party-room-${code}`;
}

// Dedicated topic for the room_id-FILTERED party_room_players postgres_changes
// feed. It can't ride the main room channel: postgres_changes filters are
// fixed at join time, and the room_id only resolves one snapshot after mount.
// Tearing down + recreating the main topic to add the filter hit a supabase-js
// race (unsubscribe of a joined channel is async; channel() returns the
// still-leaving instance, whose subscribe() silently no-ops), which left the
// recreated room channel permanently dead. A separate topic joins once, late,
// with the filter baked in — the main room channel is created exactly once.
export function roomPlayersChannel(code: string): string {
  return `party-room-${code}-players`;
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

export function triviaChannel(code: string): string {
  return `party-room-${code}-trivia`;
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
  // V2 — request-to-join + host decision + dismiss + lobby chat.
  JOIN_REQUEST: "join_request",
  JOIN_DECISION: "join_decision",
  ROOM_DISMISSED: "room_dismissed",
  LOBBY_CHAT: "lobby_chat",
  // Perf pass 2026-06-10 — ready toggles broadcast CLIENT-side the moment the
  // user taps (payload: { user_id, is_ready }), in parallel with the durable
  // REST write to party_room_players. Listeners patch their player list
  // optimistically; the postgres_changes feed + 3s poll remain the reconciler.
  // Without this, other clients only learned about a ready flip via
  // DB write → replication → realtime → full snapshot GET (~500-1500ms).
  READY_CHANGED: "ready_changed",
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
  // Phase 2 — host pause/resume. V1 is broadcast-only (no DB persistence);
  // each client freezes/resumes its local timer + disables canvas input via
  // a paused overlay. Payload: { paused_by: string; started_at: ISO }.
  PAUSED: "paused",
  RESUMED: "resumed",
  // Round-flow V2 — the effective host taps END GAME on the reveal screen.
  // Sketchy has no fixed round count (rotation runs until the host ends it),
  // so this broadcast flips every client to the shared GameOverScreen podium.
  // Empty payload; standings come from the reveal scoreboard already on each
  // client.
  GAME_OVER: "game_over",
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

// Trivia (Lightning Round — Kahoot-style MCQ race). Two phases: 'answer' then
// 'reveal'. Mirrors the bluff channel shape.
export const TRIVIA_EVENTS = {
  ROUND_STARTED: "round_started",     // a fresh question was dealt
  PHASE_CHANGED: "phase_changed",     // answer -> reveal -> next round
  ROUND_ENDED: "round_ended",         // reveal settled + scored
  ANSWER_SUBMITTED: "answer_submitted", // a player locked an answer
} as const;
