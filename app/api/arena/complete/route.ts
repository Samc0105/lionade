import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// POST — Complete a match: calculate ELO, transfer Fangs
export async function POST(req: NextRequest) {
  try {
    const { matchId, userId } = await req.json();
    if (!matchId || !userId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Get match
    const { data: match } = await supabaseAdmin
      .from("arena_matches")
      .select("*")
      .eq("id", matchId)
      .single();

    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    if (match.status === "completed") {
      return NextResponse.json({ alreadyCompleted: true, match });
    }

    // Verify user is participant
    if (match.player1_id !== userId && match.player2_id !== userId) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }

    // Get final scores from answers
    const { data: answers } = await supabaseAdmin
      .from("arena_answers")
      .select("user_id, points_earned, is_correct")
      .eq("match_id", matchId);

    let p1Points = 0, p2Points = 0, p1Correct = 0, p2Correct = 0;
    for (const a of answers ?? []) {
      if (a.user_id === match.player1_id) {
        p1Points += a.points_earned;
        if (a.is_correct) p1Correct++;
      } else {
        p2Points += a.points_earned;
        if (a.is_correct) p2Correct++;
      }
    }

    // Determine winner
    let winnerId: string | null = null;
    if (p1Points > p2Points) winnerId = match.player1_id;
    else if (p2Points > p1Points) winnerId = match.player2_id;
    // null = draw

    // Calculate ELO changes
    const p1Elo = match.player1_elo_before ?? 1000;
    const p2Elo = match.player2_elo_before ?? 1000;
    const K = 32;

    const expectedP1 = 1 / (1 + Math.pow(10, (p2Elo - p1Elo) / 400));
    const expectedP2 = 1 / (1 + Math.pow(10, (p1Elo - p2Elo) / 400));

    let actualP1: number, actualP2: number;
    if (winnerId === match.player1_id) {
      actualP1 = 1; actualP2 = 0;
    } else if (winnerId === match.player2_id) {
      actualP1 = 0; actualP2 = 1;
    } else {
      actualP1 = 0.5; actualP2 = 0.5;
    }

    const newP1Elo = Math.round(p1Elo + K * (actualP1 - expectedP1));
    const newP2Elo = Math.round(p2Elo + K * (actualP2 - expectedP2));

    // Update match record
    await supabaseAdmin
      .from("arena_matches")
      .update({
        status: "completed",
        winner_id: winnerId,
        player1_total_points: p1Points,
        player2_total_points: p2Points,
        player1_score: p1Correct,
        player2_score: p2Correct,
        player1_elo_after: newP1Elo,
        player2_elo_after: newP2Elo,
        completed_at: new Date().toISOString(),
      })
      .eq("id", matchId);

    // Update profiles: ELO + win/loss/draw counters
    const p1Updates: Record<string, number> = { arena_elo: newP1Elo };
    const p2Updates: Record<string, number> = { arena_elo: newP2Elo };

    const { data: p1Profile } = await supabaseAdmin
      .from("profiles")
      .select("arena_wins, arena_losses, arena_draws, coins")
      .eq("id", match.player1_id)
      .single();
    const { data: p2Profile } = await supabaseAdmin
      .from("profiles")
      .select("arena_wins, arena_losses, arena_draws, coins")
      .eq("id", match.player2_id)
      .single();

    if (winnerId === match.player1_id) {
      p1Updates.arena_wins = (p1Profile?.arena_wins ?? 0) + 1;
      p2Updates.arena_losses = (p2Profile?.arena_losses ?? 0) + 1;
    } else if (winnerId === match.player2_id) {
      p1Updates.arena_losses = (p1Profile?.arena_losses ?? 0) + 1;
      p2Updates.arena_wins = (p2Profile?.arena_wins ?? 0) + 1;
    } else {
      p1Updates.arena_draws = (p1Profile?.arena_draws ?? 0) + 1;
      p2Updates.arena_draws = (p2Profile?.arena_draws ?? 0) + 1;
    }

    // Transfer Fangs
    const wager = match.wager ?? 10;
    if (winnerId) {
      const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;
      const loserProfile = loserId === match.player1_id ? p1Profile : p2Profile;
      const winnerProfile = winnerId === match.player1_id ? p1Profile : p2Profile;
      const winnerUpdates = winnerId === match.player1_id ? p1Updates : p2Updates;
      const loserUpdates = loserId === match.player1_id ? p1Updates : p2Updates;

      winnerUpdates.coins = (winnerProfile?.coins ?? 0) + wager;
      loserUpdates.coins = Math.max(0, (loserProfile?.coins ?? 0) - wager);

      // Log transactions
      await Promise.all([
        supabaseAdmin.from("coin_transactions").insert({
          user_id: winnerId,
          amount: wager,
          type: "duel_win",
          reference_id: matchId,
          description: `Arena duel victory — won ${wager} Fangs`,
        }),
        supabaseAdmin.from("coin_transactions").insert({
          user_id: loserId,
          amount: -wager,
          type: "duel_loss",
          reference_id: matchId,
          description: `Arena duel defeat — lost ${wager} Fangs`,
        }),
      ]);
    }
    // Draw: no Fang transfer

    // Apply profile updates
    await Promise.all([
      supabaseAdmin.from("profiles").update(p1Updates).eq("id", match.player1_id),
      supabaseAdmin.from("profiles").update(p2Updates).eq("id", match.player2_id),
    ]);

    return NextResponse.json({
      winnerId,
      isDraw: !winnerId,
      player1: {
        points: p1Points,
        correct: p1Correct,
        eloBefore: p1Elo,
        eloAfter: newP1Elo,
        eloChange: newP1Elo - p1Elo,
      },
      player2: {
        points: p2Points,
        correct: p2Correct,
        eloBefore: p2Elo,
        eloAfter: newP2Elo,
        eloChange: newP2Elo - p2Elo,
      },
      wager,
    });
  } catch (e) {
    console.error("[arena/complete POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
