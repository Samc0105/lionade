// Poker Face — present a hand.
//
// POST /api/competitive/pokerface/present
// Body: { matchId, handNum, isTruth, claimText, openingStake, raise? }
//
// The presenter draws (server-side, from the curated deck) a card, decides
// truth-or-lie, writes the claim they want to show (the LIE is player-authored),
// and sets a BOUNDED opening stake (+ optional single bounded raise). Creates
// the pokerface_hands row in phase 'call' so the caller can respond.
//
// SECURITY / BOUNDED-STAKE ENFORCEMENT:
//   - presenter must be the correct participant for this hand's parity
//     (presenter alternates each hand; hand 0/2/4 = team_a[0], 1/3/5 = team_b[0]).
//   - opening stake must be one of [10,25,50].
//   - raise is clamped server-side via clampRaise() to <=2x opening, <=250 total,
//     and <= min(both balances, both loss-cap headrooms). NEVER trust body raise.
//   - presenter and caller must each be able to AFFORD total_stake (>= balance).
//   - userId comes from requireAuth, never the body.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  isValidOpeningStake,
  clampRaise,
} from "@/lib/competitive/pokerface-wager";
import { drawRandomCard } from "@/lib/competitive/pokerface-cards";
import {
  resolveLossCapTier,
  computeLossWindow,
} from "@/lib/arena-v2/loss-cap";
import type { CompetitiveMatchRow } from "@/lib/competitive/types";

/** Loss-cap headroom (positive Fangs still loseable today) for a user. */
async function lossCapHeadroom(userId: string, elo: number, isPro: boolean): Promise<number> {
  const tier = resolveLossCapTier({ elo, isPro });
  const win = await computeLossWindow(supabaseAdmin, userId);
  // cap is negative (e.g. -300); net is negative when down. Headroom is how
  // much more they can lose before hitting the cap.
  const headroom = win.netFangsLast24h - tier.capFangs; // e.g. (-100) - (-300) = 200
  return Math.max(0, headroom);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json().catch(() => ({}));
    const matchId: string | undefined = body?.matchId;
    const handNum: number = Number.isInteger(body?.handNum) ? body.handNum : -1;
    const isTruth: boolean = body?.isTruth === true;
    const claimText: string = typeof body?.claimText === "string" ? body.claimText.slice(0, 280) : "";
    const openingStake = body?.openingStake;
    const requestedRaise: number = Number.isFinite(body?.raise) ? Math.max(0, Math.floor(body.raise)) : 0;

    if (!matchId || handNum < 0 || !isValidOpeningStake(openingStake)) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const { data: matchRaw } = await supabaseAdmin
      .from("competitive_matches")
      .select("*")
      .eq("id", matchId)
      .single();
    if (!matchRaw) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    const match = matchRaw as CompetitiveMatchRow;
    if (match.mode !== "pokerface") {
      return NextResponse.json({ error: "Not a pokerface match" }, { status: 400 });
    }

    // Presenter parity: even hands = team_a[0] presents, odd = team_b[0].
    const presenterId = handNum % 2 === 0 ? match.team_a[0] : match.team_b[0];
    const callerId = handNum % 2 === 0 ? match.team_b[0] : match.team_a[0];
    if (userId !== presenterId) {
      return NextResponse.json({ error: "Not the presenter for this hand" }, { status: 403 });
    }

    // Idempotency: if this hand already exists past 'present', reject.
    const { data: existing } = await supabaseAdmin
      .from("pokerface_hands")
      .select("id, phase")
      .eq("match_id", matchId)
      .eq("hand_num", handNum)
      .maybeSingle();
    if (existing && existing.phase !== "present") {
      return NextResponse.json({ error: "Hand already presented" }, { status: 409 });
    }

    // Read both balances + ELO + plan for the stake clamp.
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, coins, plan, competitive_elo")
      .in("id", [presenterId, callerId]);
    const pres = profiles?.find((p) => p.id === presenterId);
    const call = profiles?.find((p) => p.id === callerId);
    if (!pres || !call) {
      return NextResponse.json({ error: "Profiles not found" }, { status: 404 });
    }

    const presHeadroom = await lossCapHeadroom(presenterId, pres.competitive_elo ?? 1000, pres.plan === "pro");
    const callHeadroom = await lossCapHeadroom(callerId, call.competitive_elo ?? 1000, call.plan === "pro");
    const headroom = Math.min(
      pres.coins ?? 0,
      call.coins ?? 0,
      presHeadroom,
      callHeadroom,
    );

    // Opening stake must itself be affordable by both within headroom.
    if (openingStake > headroom) {
      return NextResponse.json(
        { error: "Stake exceeds available balance or daily limit" },
        { status: 400 },
      );
    }

    const raise = clampRaise({ openingStake, requestedRaise, headroom });
    const totalStake = openingStake + raise;

    // The card the presenter drew (kept server-side; client never trusted to
    // supply card_fact). If the presenter chose to tell the truth, the claim
    // shown IS the card fact; otherwise it's their authored lie.
    const card = drawRandomCard();
    const shownClaim = isTruth ? card.fact : (claimText || "(no claim provided)");

    // Upsert the hand in phase 'call'.
    const handRow = {
      match_id: matchId,
      hand_num: handNum,
      presenter_id: presenterId,
      caller_id: callerId,
      card_word: card.word,
      card_fact: card.fact,
      claim_text: shownClaim,
      is_truth: isTruth,
      opening_stake: openingStake,
      raise_amount: raise,
      total_stake: totalStake,
      phase: "call",
    };

    if (existing) {
      await supabaseAdmin.from("pokerface_hands").update(handRow).eq("id", existing.id);
    } else {
      await supabaseAdmin.from("pokerface_hands").insert(handRow);
    }

    return NextResponse.json({
      ok: true,
      handNum,
      cardWord: card.word,
      claimShown: shownClaim,
      openingStake,
      raise,
      totalStake,
      callerId,
    });
  } catch (e) {
    console.error("[competitive/pokerface/present]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
