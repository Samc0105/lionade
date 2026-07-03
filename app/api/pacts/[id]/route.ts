import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { loadMemberPact } from "@/lib/pacts";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/pacts/[id] — end a pact (or cancel your own pending invite).
 *
 * Upside-only economics: ending a pact loses nothing but the shared count.
 * The row is kept as status='ended' (never hard-deleted) because the pair-
 * unique row carries the milestone booleans; a later re-invite recycles it,
 * which is what prevents milestone re-farming.
 */
export async function DELETE(
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
    if (!pact || pact.status === "ended") {
      return NextResponse.json({ error: "Pact not found" }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from("streak_pacts")
      .update({ status: "ended" })
      .eq("id", pact.id)
      .neq("status", "ended");
    if (error) {
      console.error("[pacts DELETE]", error.message);
      return NextResponse.json({ error: "Couldn't end the pact." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[pacts DELETE]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
