/**
 * Demo account guards (universal — safe to import from client + server).
 *
 * Lionade ships a publicly-known shared demo account
 * (demo@getlionade.com / LionadeDemo2026!) so testers can try the app
 * without signing up. Because the credentials are printed on the login
 * page, the account is publicly known and any abuse vector should be
 * short-circuited server-side.
 *
 * The UUID below MUST match the value inserted by the corresponding
 * Supabase migration:
 *   supabase/migrations/<timestamp>_demo_account.sql
 *
 * If the migration ever changes the UUID, change it here in lockstep.
 *
 * Server-side route usage:
 *
 *   import { requireAuth } from "@/lib/api-auth";
 *   import { isDemoUser } from "@/lib/demo-guard";
 *   import { demoBlockedResponse } from "@/lib/demo-guard-server";
 *
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;
 *   if (isDemoUser(auth.userId)) return demoBlockedResponse();
 *
 * Always add the guard AFTER requireAuth so the userId is authenticated
 * by the JWT — never trust an id pulled from the request body.
 *
 * Client-side usage (banner + leaderboard filter):
 *
 *   import { isDemoUser, DEMO_USER_ID } from "@/lib/demo-guard";
 *   if (isDemoUser(user.id)) { ... render banner ... }
 *
 * This file MUST stay free of server-only imports (next/server,
 * supabase-server, etc.) so it tree-shakes cleanly into the client bundle.
 * The NextResponse helper lives in lib/demo-guard-server.ts instead.
 */

/**
 * Stable UUID for the shared demo account. Hardcoded everywhere instead of
 * read from env so a config-edit can't accidentally promote a real user to
 * "demo" status and bypass these guards on their own account.
 */
export const DEMO_USER_ID = "d3500000-0000-0000-0000-000000000000";

/** True iff the supplied userId is the demo account. */
export function isDemoUser(userId: string | null | undefined): boolean {
  return userId === DEMO_USER_ID;
}
