// ONE missing-schema detector for every HELD-migration fail-soft path.
//
// Consolidates the four guards that grew independently (lib/review-hub.ts,
// lib/pacts.ts, lib/focus-rooms/schema-guard.ts, lib/library/schema-guard.ts)
// so no feature's guard can silently miss a code the others learned about.
// The focus/pacts copies previously lacked PGRST205 — the exact error
// PostgREST's schema cache raises for an unapplied table migration — which
// would have 500ed the held-migration scenario they exist to absorb.
//
// Covered:
//   Postgres  42P01  undefined_table
//   Postgres  42703  undefined_column
//   Postgres  42883  undefined_function (held RPC migrations)
//   PostgREST PGRST204  column missing from the schema cache
//   PostgREST PGRST205  table missing from the schema cache
//   plus the message-regex fallback for proxied/wrapped errors that lose
//   their code ("... does not exist" / "... schema cache").
//
// CLIENT-SAFE: no imports, pure predicate. Safe to reference from anywhere.

const MISSING_SCHEMA_CODES = new Set([
  "42P01",
  "42703",
  "42883",
  "PGRST204",
  "PGRST205",
]);

/** True when a Supabase/PostgREST error means a HELD migration isn't applied yet. */
export function isMissingSchema(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (typeof code === "string" && MISSING_SCHEMA_CODES.has(code)) return true;
  return typeof message === "string" && /does not exist|schema cache/i.test(message);
}
