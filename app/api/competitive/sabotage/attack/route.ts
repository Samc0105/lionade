// Sabotage Trivia — durable attack record.
//
// POST /api/competitive/sabotage/attack
// Body: { matchId, targetId, kind }
//
// The LIVE attack is delivered peer-to-peer via Supabase broadcast on the match
// channel (the client fires it instantly for responsiveness). This endpoint
// writes the durable audit row AND server-validates: attacker must be a match
// participant, target must be on the OPPOSING team, kind must be a known attack.
//
// We intentionally do NOT validate the charge meter here — the meter is a
// client-side responsiveness construct and the worst-case abuse (spamming
// attacks) is cosmetic harassment within a single 90s match, not Fang/ELO
// theft (the outcome is decided by the score the /complete endpoint receives).
// A future hardening pass can move the meter server-side; flagged as a TODO.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { ATTACK_COSTS } from "@/lib/competitive/sabotage-economy";
import type { SabotageAttackKind } from "@/lib/competitive/channels";
import type { CompetitiveMatchRow } from "@/lib/competitive/types";

const VALID_KINDS: SabotageAttackKind[] = [
  "blur", "scramble", "drain", "decoy", "freeze", "fog",
];

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json().catch(() => ({}));
    const matchId: string | undefined = body?.matchId;
    const targetId: string | undefined = body?.targetId;
    const kind = body?.kind as SabotageAttackKind | undefined;

    if (!matchId || !targetId || !kind || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const { data: matchRaw } = await supabaseAdmin
      .from("competitive_matches")
      .select("*")
      .eq("id", matchId)
      .single();
    if (!matchRaw) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    const match = matchRaw as CompetitiveMatchRow;

    if (match.mode !== "sabotage") {
      return NextResponse.json({ error: "Not a sabotage match" }, { status: 400 });
    }

    const attackerOnA = match.team_a.includes(userId);
    const attackerOnB = match.team_b.includes(userId);
    if (!attackerOnA && !attackerOnB) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }
    // Target must be on the OPPOSING team.
    const enemyTeam = attackerOnA ? match.team_b : match.team_a;
    if (!enemyTeam.includes(targetId)) {
      return NextResponse.json({ error: "Target not on opposing team" }, { status: 403 });
    }

    await supabaseAdmin.from("sabotage_attacks").insert({
      match_id: matchId,
      attacker_id: userId,
      target_id: targetId,
      kind,
      cost: ATTACK_COSTS[kind],
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[competitive/sabotage/attack]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
