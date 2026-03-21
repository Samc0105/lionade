import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// POST — Send a challenge to a friend (by username)
export async function POST(req: NextRequest) {
  try {
    const { challengerId, challengedUsername, wager } = await req.json();
    if (!challengerId || !challengedUsername) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const validWagers = [10, 25, 50, 100];
    const safeWager = validWagers.includes(wager) ? wager : 10;

    // Look up challenged user
    const { data: challenged } = await supabaseAdmin
      .from("profiles")
      .select("id, username, coins")
      .ilike("username", challengedUsername)
      .single();

    if (!challenged) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (challenged.id === challengerId) {
      return NextResponse.json({ error: "Cannot challenge yourself" }, { status: 400 });
    }

    // Check both players have enough Fangs
    const { data: challenger } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", challengerId)
      .single();

    if (!challenger || challenger.coins < safeWager) {
      return NextResponse.json({ error: "You don't have enough Fangs" }, { status: 400 });
    }
    if (challenged.coins < safeWager) {
      return NextResponse.json({ error: "Opponent doesn't have enough Fangs" }, { status: 400 });
    }

    // Cancel any existing pending challenges from this user
    await supabaseAdmin
      .from("arena_challenges")
      .update({ status: "expired" })
      .eq("challenger_id", challengerId)
      .eq("status", "pending");

    // Create challenge
    const { data, error } = await supabaseAdmin
      .from("arena_challenges")
      .insert({
        challenger_id: challengerId,
        challenged_id: challenged.id,
        wager: safeWager,
        status: "pending",
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      challenge: data,
      challengedUser: { id: challenged.id, username: challenged.username },
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET — Check for incoming challenges
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

    // Get pending challenges where I'm the challenged party
    const { data: incoming } = await supabaseAdmin
      .from("arena_challenges")
      .select("id, challenger_id, wager, created_at, expires_at")
      .eq("challenged_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    // Get challenger profiles
    const challenges = [];
    for (const c of incoming ?? []) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("username, avatar_url, arena_elo")
        .eq("id", c.challenger_id)
        .single();

      challenges.push({
        id: c.id,
        challengerId: c.challenger_id,
        challengerName: profile?.username ?? "Unknown",
        challengerAvatar: profile?.avatar_url,
        challengerElo: profile?.arena_elo ?? 1000,
        wager: c.wager,
        createdAt: c.created_at,
        expiresAt: c.expires_at,
      });
    }

    // Also check if I sent a challenge that was accepted
    const { data: accepted } = await supabaseAdmin
      .from("arena_challenges")
      .select("id, match_id")
      .eq("challenger_id", userId)
      .eq("status", "accepted")
      .not("match_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      challenges,
      acceptedChallenge: accepted ? { id: accepted.id, matchId: accepted.match_id } : null,
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH — Accept or decline a challenge
export async function PATCH(req: NextRequest) {
  try {
    const { challengeId, userId, action } = await req.json();
    if (!challengeId || !userId || !["accept", "decline"].includes(action)) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { data: challenge } = await supabaseAdmin
      .from("arena_challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("challenged_id", userId)
      .eq("status", "pending")
      .single();

    if (!challenge) {
      return NextResponse.json({ error: "Challenge not found or expired" }, { status: 404 });
    }

    if (action === "decline") {
      await supabaseAdmin
        .from("arena_challenges")
        .update({ status: "declined" })
        .eq("id", challengeId);
      return NextResponse.json({ success: true, status: "declined" });
    }

    // Accept: create match
    // Select questions
    const { data: allQuestions } = await supabaseAdmin
      .from("questions")
      .select("id, difficulty, topic, question")
      .in("topic", ["algebra", "biology", "chemistry", "physics", "earth-science", "astronomy"])
      .limit(200);

    const shuffled = (allQuestions ?? []).sort(() => Math.random() - 0.5);
    const questionIds = shuffled.slice(0, 10).map(q => q.id);

    if (questionIds.length < 5) {
      return NextResponse.json({ error: "Not enough questions available" }, { status: 500 });
    }

    // Get ELO ratings
    const [{ data: p1 }, { data: p2 }] = await Promise.all([
      supabaseAdmin.from("profiles").select("arena_elo").eq("id", challenge.challenger_id).single(),
      supabaseAdmin.from("profiles").select("arena_elo").eq("id", challenge.challenged_id).single(),
    ]);

    // Create match
    const { data: match, error: matchErr } = await supabaseAdmin
      .from("arena_matches")
      .insert({
        player1_id: challenge.challenger_id,
        player2_id: challenge.challenged_id,
        question_ids: questionIds,
        wager: challenge.wager,
        status: "pending",
        player1_elo_before: p1?.arena_elo ?? 1000,
        player2_elo_before: p2?.arena_elo ?? 1000,
      })
      .select()
      .single();

    if (matchErr || !match) {
      return NextResponse.json({ error: "Failed to create match" }, { status: 500 });
    }

    // Run judge on questions
    const questions = shuffled.slice(0, 10);
    const judgeRows = questions.map((q, idx) => {
      const text = q.question?.toLowerCase() ?? "";
      const len = (q.question ?? "").length;
      let timeLimit = 15;
      let cognitiveLoad = "recall";

      if (text.includes("calculate") || text.includes("solve")) {
        cognitiveLoad = "calculation";
        timeLimit = len > 150 ? 22 : 18;
      } else if (text.includes("why") || text.includes("explain")) {
        cognitiveLoad = "reasoning";
        timeLimit = len > 150 ? 20 : 15;
      } else {
        timeLimit = len > 200 ? 15 : len > 100 ? 12 : 10;
      }
      if (q.difficulty === "advanced") timeLimit = Math.min(25, timeLimit + 4);
      else if (q.difficulty === "beginner") timeLimit = Math.max(8, timeLimit - 2);

      return {
        match_id: match.id,
        question_id: q.id,
        question_order: idx,
        time_limit: timeLimit,
        cognitive_load: cognitiveLoad,
      };
    });

    await supabaseAdmin.from("arena_match_questions").insert(judgeRows);

    // Update challenge
    await supabaseAdmin
      .from("arena_challenges")
      .update({ status: "accepted", match_id: match.id })
      .eq("id", challengeId);

    return NextResponse.json({ success: true, status: "accepted", matchId: match.id });
  } catch (e) {
    console.error("[arena/challenge PATCH]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
