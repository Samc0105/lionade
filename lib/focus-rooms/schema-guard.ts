// Fail-soft guard for the HELD focus_rooms migration (20260702110000).
//
// Until Sam applies it, every focus_rooms/focus_room_members read or write
// fails with a missing-schema error. Routes detect that and self-disable with
// honest copy instead of 500ing (same philosophy as lib/weak-spot-review.ts's
// optional-column handling).
//
// Detection is the SHARED predicate in lib/db/missing-schema.ts — the local
// copy this file used to carry missed PGRST205 (PostgREST's schema-cache
// "table not found"), which is exactly what an unapplied table migration
// raises, so the held state would have 500ed instead of self-disabling.

import { NextResponse } from "next/server";
import { isMissingSchema } from "@/lib/db/missing-schema";

/** True when a Supabase/Postgrest error means the focus tables don't exist yet. */
export const isMissingFocusRoomsSchema = isMissingSchema;

export const FOCUS_ROOMS_UNAVAILABLE_MESSAGE =
  "Focus Rooms isn't live yet. Check back soon.";

/** Canonical 503 for mutating routes while the migration is unapplied. */
export function focusRoomsUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { unavailable: true, error: FOCUS_ROOMS_UNAVAILABLE_MESSAGE },
    { status: 503 },
  );
}
