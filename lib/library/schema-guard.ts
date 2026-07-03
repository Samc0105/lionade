// Fail-soft guard for the HELD study-set library migrations
// (20260702130000_study_sets.sql + 20260702140000_library_addendum.sql).
//
// Until Sam applies them, reads/writes against study_sets, study_set_cards,
// library_reports, or the addendum columns (is_public, published_at,
// clone_count, cloned_from) fail with a missing-schema error. Routes detect
// that and self-disable with honest copy instead of 500ing.
//
// THIN RE-EXPORT: detection is the shared predicate in
// lib/db/missing-schema.ts (also covers PGRST204/PGRST205 schema-cache codes
// the old local copy missed). Kept as a module so the library routes'
// imports stay stable.

import { NextResponse } from "next/server";
import { isMissingSchema } from "@/lib/db/missing-schema";

/** True when a Supabase/Postgrest error means the library schema isn't applied yet. */
export const isMissingLibrarySchema = isMissingSchema;

export const LIBRARY_UNAVAILABLE_MESSAGE =
  "The community library isn't live yet. Check back soon.";

/** Canonical 503 for mutating routes while the migrations are unapplied. */
export function libraryUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { unavailable: true, error: LIBRARY_UNAVAILABLE_MESSAGE },
    { status: 503 },
  );
}
