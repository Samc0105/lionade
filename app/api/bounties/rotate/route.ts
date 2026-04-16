import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { checkAndRotateBounties } from "@/lib/bounty-rotation";

export const dynamic = "force-dynamic";

// POST /api/bounties/rotate
// Called on dashboard load. Checks if rotation is needed and performs it.
// Idempotent — safe to call multiple times.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const result = await checkAndRotateBounties();
  return NextResponse.json(result);
}
