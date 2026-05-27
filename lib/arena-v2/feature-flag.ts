// Arena V2 feature flag.
//
// Phase 1 is shipped behind this flag — V1 keeps running for all live users.
// Server-side reads `process.env.NEXT_PUBLIC_ARENA_V2_ENABLED` (Next.js
// inlines NEXT_PUBLIC_* into both server bundles and client bundles, so the
// same env var works on both sides).
//
// Set in .env.local during dev:
//   NEXT_PUBLIC_ARENA_V2_ENABLED=true
//
// In production this stays unset (falsy) until Phase 2 ships the UI.

export function isArenaV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_ARENA_V2_ENABLED === "true";
}
