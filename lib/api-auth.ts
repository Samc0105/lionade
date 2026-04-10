// Server-side auth helper for API routes.
// Reads `Authorization: Bearer <access_token>` from the request and verifies
// it via the Supabase admin client. Returns the authenticated user id or null.
//
// Usage in a route handler:
//
//   import { requireAuth } from "@/lib/api-auth";
//   const auth = await requireAuth(req);
//   if (auth instanceof NextResponse) return auth;  // 401
//   const userId = auth.userId;
//
// NEVER read userId from the request body in a mutating route. Always use this
// helper. The body is attacker-controlled.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-server";

export interface AuthedUser {
  userId: string;
  email: string | null;
}

/** Returns the authenticated user, or null if no/invalid token. */
export async function getAuthedUser(req: NextRequest): Promise<AuthedUser | null> {
  const header = req.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return null;
    return { userId: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

/**
 * Returns either an `AuthedUser` or a `NextResponse` (401) ready to return.
 * Use with: `const auth = await requireAuth(req); if (auth instanceof NextResponse) return auth;`
 */
export async function requireAuth(
  req: NextRequest,
): Promise<AuthedUser | NextResponse> {
  const user = await getAuthedUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return user;
}
