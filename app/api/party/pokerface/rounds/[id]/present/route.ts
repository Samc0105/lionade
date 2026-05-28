// POST /api/party/pokerface/rounds/[id]/present — presenter commits the hand.
//
// Body: { isLie: boolean, claimText?: string }
//
// Only the round's PRESENTER may present, and only while phase='present'.
//   - If isLie === false (telling the truth): the claim shown is FORCED to the
//     card's true fact server-side. The client cannot claim "truth" yet display a
//     different string — that would let a liar masquerade as honest at reveal.
//   - If isLie === true (bluffing): the presenter's authored claimText is shown
//     (trimmed, capped). The LIE is always player-authored; we never generate it.
//   - We persist is_lie (the secret) + claim_text and advance phase -> 'vote' so
//     callers can call. card_fact stays untouched (the verbatim truth).
//
// Server-authoritative + secret-safe: is_lie is decided here and stored; it is
// never echoed to callers until reveal (the GET route + RLS enforce that).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

const MAX_CLAIM_LEN = 280;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const isLie = body?.isLie === true;
  const rawClaim = typeof body?.claimText === "string" ? body.claimText : "";

  const { data: round } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .select("id, presenter_user_id, phase, card_fact")
    .eq("id", params.id)
    .maybeSingle();
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.presenter_user_id !== userId) {
    return NextResponse.json({ error: "Only the presenter can present this hand" }, { status: 403 });
  }
  if (round.phase !== "present") {
    return NextResponse.json({ error: "This hand has already been presented" }, { status: 409 });
  }

  // Truth → the shown claim IS the card fact (server-forced). Lie → the
  // presenter's authored claim (must be non-empty).
  let claimText: string;
  if (isLie) {
    claimText = rawClaim.trim().slice(0, MAX_CLAIM_LEN);
    if (claimText.length === 0) {
      return NextResponse.json(
        { error: "Write the lie you want to present." },
        { status: 400 },
      );
    }
  } else {
    claimText = round.card_fact;
  }

  const { error } = await supabaseAdmin
    .from("party_pokerface_rounds")
    .update({
      is_lie: isLie,
      claim_text: claimText,
      phase: "vote",
      presented_at: new Date().toISOString(),
    })
    .eq("id", round.id)
    .eq("phase", "present");  // guard against a double-present race
  if (error) {
    console.error("[party/pokerface/present]", error.message);
    return NextResponse.json({ error: "Couldn't present the hand" }, { status: 500 });
  }

  // Return only the claim shown — never echo is_lie back in a way a caller could
  // read (this response goes to the presenter, who already knows, but we keep it
  // minimal). Callers learn claim_text via the phase-aware GET route.
  return NextResponse.json({ ok: true, phase: "vote", claim_text: claimText });
}
