// Competitive platform — shared scoring helpers for distance-based modes.
//
// Spectrum Slider and Map Pin Drop both score by "closeness": the nearer your
// estimate is to the true value, the more points. These helpers produce a
// 0..1000 per-round score so the modes share one scale, which the completion
// endpoint compares between teams.

/**
 * Spectrum: score a single guess against the true value within [min, max].
 * Perfect = 1000. Falls off with the fraction of the full range you're off by.
 * Quadratic falloff so being "in the ballpark" still scores reasonably while
 * wild guesses score near zero.
 */
export function scoreSpectrum(args: {
  guess: number;
  trueValue: number;
  min: number;
  max: number;
}): number {
  const range = Math.max(1e-9, args.max - args.min);
  const errFrac = Math.min(1, Math.abs(args.guess - args.trueValue) / range);
  const score = 1000 * (1 - errFrac) ** 2;
  return Math.round(Math.max(0, score));
}

/**
 * Map Pin: score a pin drop by haversine distance (km) to the true point.
 * Perfect (0 km) = 1000. Uses an exponential decay so a pin within a few
 * hundred km still scores well, and a wrong-continent pin scores near zero.
 * Half-life ~1500 km (a pin 1500 km off scores ~500).
 */
export function scorePin(distanceKm: number): number {
  const HALF_LIFE_KM = 1500;
  const score = 1000 * Math.pow(0.5, distanceKm / HALF_LIFE_KM);
  return Math.round(Math.max(0, score));
}

/**
 * Zoom Reveal: score a correct guess by how early it landed.
 * `elapsedMs` is time since the round started; `revealMs` is the full reveal
 * window. Guessing instantly = 1000; guessing at the very end = a 200 floor
 * (you still got it right). A wrong/locked round scores 0 (handled by caller).
 */
export function scoreZoom(args: {
  elapsedMs: number;
  revealMs: number;
}): number {
  const frac = Math.min(1, Math.max(0, args.elapsedMs / Math.max(1, args.revealMs)));
  const score = 1000 - 800 * frac; // 1000 down to 200
  return Math.round(score);
}
