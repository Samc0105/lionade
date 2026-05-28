// Competitive platform — SERVER-AUTHORITATIVE per-answer scoring.
//
// This is the single source of truth that grades a player's raw submission
// against the round's SECRET. It runs ONLY on the server (inside the /answer
// route, with the service-role client), so the secret (correct_index / answer /
// true_value / true_lat,lng) never has to leave the database for the client to
// learn its own score. The route persists the returned points to
// competitive_responses; the /complete route sums those — the client-submitted
// score is never trusted.
//
// Each grader returns:
//   - points: 0..1000 server-computed score (the same scales the client used to
//     compute locally, now computed here from the secret)
//   - isCorrect: did the player get it right (for sabotage/zoom semantics)
//   - reveal: the now-safe-to-disclose secret for THIS player's just-answered
//     round, so the screen can render its reveal UI (true marker, the answer)
//     without ever having held the secret beforehand.

import { compareGuess } from "@/lib/party/levenshtein";
import { haversineKm } from "./pin-places";
import { scoreSpectrum, scorePin, scoreZoom } from "./scoring";
import type { CompetitiveMode } from "./types";

export interface SabotageRoundSecret {
  correct_index: number;
  options: unknown;
}
export interface ZoomRoundSecret {
  answer: string;
  aliases: unknown;
  reveal_sec: number;
}
export interface SpectrumRoundSecret {
  true_value: number;
  min_value: number;
  max_value: number;
}
export interface PinRoundSecret {
  true_lat: number;
  true_lng: number;
}

export interface ScoredAnswer {
  points: number;
  isCorrect: boolean;
  reveal: Record<string, unknown>;
}

/** Sabotage: 1 point for a correct option (matches the client's +1 per correct). */
export function scoreSabotageAnswer(
  round: SabotageRoundSecret,
  rawIndex: unknown,
): ScoredAnswer {
  const idx = Number.isInteger(rawIndex) ? (rawIndex as number) : -1;
  const isCorrect = idx === round.correct_index;
  return {
    points: isCorrect ? 1 : 0,
    isCorrect,
    reveal: { correct_index: round.correct_index },
  };
}

/**
 * Zoom: a correct/alias guess scores by how early it landed (scoreZoom). A wrong
 * guess scores 0. The client passes the elapsed ms it took to guess; we clamp it
 * to the reveal window server-side so a tampered elapsed can't inflate the early
 * bonus beyond the legitimate range.
 */
export function scoreZoomAnswer(
  round: ZoomRoundSecret,
  rawGuess: unknown,
  rawElapsedMs: unknown,
): ScoredAnswer {
  const guess = typeof rawGuess === "string" ? rawGuess : "";
  const revealMs = (round.reveal_sec ?? 15) * 1000;
  const elapsedMs = Math.max(0, Math.min(revealMs, Number(rawElapsedMs) || revealMs));
  const aliases = Array.isArray(round.aliases) ? (round.aliases as string[]) : [];
  const hit =
    compareGuess(guess, round.answer) === "correct" ||
    aliases.some((a) => compareGuess(guess, a) === "correct");
  const points = hit ? scoreZoom({ elapsedMs, revealMs }) : 0;
  return {
    points,
    isCorrect: hit,
    reveal: { answer: round.answer },
  };
}

/** Spectrum: distance-based partial credit (scoreSpectrum) vs the true value. */
export function scoreSpectrumAnswer(
  round: SpectrumRoundSecret,
  rawGuess: unknown,
): ScoredAnswer {
  const guess = Number(rawGuess);
  const safeGuess = Number.isFinite(guess) ? guess : round.min_value;
  const points = scoreSpectrum({
    guess: safeGuess,
    trueValue: round.true_value,
    min: round.min_value,
    max: round.max_value,
  });
  return {
    points,
    isCorrect: points >= 950,
    reveal: { true_value: round.true_value },
  };
}

/** Pin: haversine distance → exponential-decay score (scorePin). */
export function scorePinAnswer(
  round: PinRoundSecret,
  rawLat: unknown,
  rawLng: unknown,
): ScoredAnswer {
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { points: 0, isCorrect: false, reveal: { true_lat: round.true_lat, true_lng: round.true_lng } };
  }
  const dist = haversineKm(lat, lng, round.true_lat, round.true_lng);
  const points = scorePin(dist);
  return {
    points,
    isCorrect: points >= 950,
    reveal: { true_lat: round.true_lat, true_lng: round.true_lng, distance_km: Math.round(dist) },
  };
}

/** Modes whose per-round answers are server-scored via competitive_responses. */
export const SCORED_MODES: CompetitiveMode[] = ["sabotage", "zoom", "spectrum", "pin"];

export function isScoredMode(mode: string): boolean {
  return (SCORED_MODES as string[]).includes(mode);
}
