import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { loadMemberPact } from "@/lib/pacts";

export const dynamic = "force-dynamic";

/**
 * POST /api/pacts/[id]/decline — invitee declines a pending pact invite.
 *
 * Sets status='ended' (not a hard delete): the pair-unique row is recycled if
 * either side re-invites later, and its milestone booleans stay preserved.
 * No notification is sent on decline, matching the friend-request pattern.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const pact = await loadMemberPact(params.id, userId);
    if (pact === "missing-schema") {
      return NextResponse.json({ error: "Pacts aren't live yet." }, { status: 503 });
    }
    if (!pact || pact.status !== "pending") {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (pact.invited_by === userId) {
      return NextResponse.json(
        { error: "Use end (DELETE) to cancel an invite you sent." },
        { status: 403 },
      );
    }

    const { error } = await supabaseAdmin
      .from("streak_pacts")
      .update({ status: "ended" })
      .eq("id", pact.id)
      .eq("status", "pending");
    if (error) {
      console.error("[pacts decline]", error.message);
      return NextResponse.json({ error: "Couldn't decline the invite." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[pacts decline]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
