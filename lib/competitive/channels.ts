// Competitive platform — Realtime channel name helpers.
//
// One channel per match, keyed by the match UUID (stable, unique). Sabotage
// real-time attacks ride a per-match channel via Supabase BROADCAST (not
// postgres_changes — same lesson as docs/architecture/lionade-party-realtime.md:
// postgres_changes is the wrong tool for high-frequency peer events).
//
// Channel naming follows the realtime hard-rule <feature>-<resource-id>:
//   competitive-match-<matchId>
//
// All five modes can share the match channel; mode-specific event names keep
// traffic disambiguated. Sabotage is the only high-frequency case today.

export function matchChannel(matchId: string): string {
  return `competitive-match-${matchId}`;
}

// ── Sabotage broadcast events ──
// `attack`   — attacker fires an effect at a target (peer → peer, applied client-side)
// `answered` — a player locked an answer (drives meter/score sync UI)
// `round`    — server advanced the round (low-frequency state)
// `finished` — a player reached the end / match is settling
export const SABOTAGE_EVENTS = {
  ATTACK: "attack",
  ANSWERED: "answered",
  ROUND: "round",
  FINISHED: "finished",
} as const;

// ── Generic mode lifecycle events (zoom / spectrum / pin) ──
export const COMPETITIVE_EVENTS = {
  PROGRESS: "progress",   // opponent advanced a round (score/round sync)
  GUESS: "guess",         // a guess/answer landed (zoom lock, spectrum lock)
  FINISHED: "finished",   // a side finished all rounds
} as const;

// ── Sabotage attack kinds + tuned costs ──
// Tuned so a skilled player (fast + correct) accrues ~3-5 attacks in a 90s
// match. Each correct+fast answer charges the meter; attacks spend charge.
// Cooldown prevents chain-spam. See lib/competitive/sabotage-economy.ts.
export type SabotageAttackKind =
  | "blur"      // blur the opponent's question for 3s
  | "scramble"  // shuffle the opponent's answer options
  | "drain"     // drain 5s off the opponent's round timer
  | "decoy"     // highlight a wrong answer as if it were "suggested"
  | "freeze"    // freeze the opponent's input for 2s
  | "fog";      // hide 2 of the opponent's 4 options for a moment

export interface AttackPayload {
  type: typeof SABOTAGE_EVENTS.ATTACK;
  kind: SabotageAttackKind;
  attacker_id: string;
  target_id: string;
}
