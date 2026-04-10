import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

// POST — Join the matchmaking queue
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const { wager } = await req.json();

    const validWagers = [10, 25, 50, 100];
    const safeWager = validWagers.includes(wager) ? wager : 10;

    // Check user has enough Fangs
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins, arena_elo")
      .eq("id", userId)
      .single();

    if (!profile || profile.coins < safeWager) {
      return NextResponse.json({ error: "Not enough Fangs" }, { status: 400 });
    }

    // Remove any existing waiting entries for this user
    await supabaseAdmin
      .from("arena_queue")
      .delete()
      .eq("user_id", userId)
      .eq("status", "waiting");

    // Insert into queue
    const { data, error } = await supabaseAdmin
      .from("arena_queue")
      .insert({
        user_id: userId,
        elo_rating: profile.arena_elo ?? 1000,
        wager: safeWager,
        status: "waiting",
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ queueEntry: data });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET — Poll for a match (called every 2s by client)
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    // Check my queue entry
    const { data: myEntry } = await supabaseAdmin
      .from("arena_queue")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "waiting")
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!myEntry) {
      // Check if already matched
      const { data: matched } = await supabaseAdmin
        .from("arena_queue")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "matched")
        .order("joined_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (matched?.match_id) {
        return NextResponse.json({ status: "matched", matchId: matched.match_id });
      }
      return NextResponse.json({ status: "not_in_queue" });
    }

    // How long have we been waiting?
    const waitMs = Date.now() - new Date(myEntry.joined_at).getTime();
    const eloRange = waitMs > 30000 ? 500 : 200;

    // Look for opponent within ELO range with same wager
    const { data: opponent } = await supabaseAdmin
      .from("arena_queue")
      .select("*")
      .eq("status", "waiting")
      .eq("wager", myEntry.wager)
      .neq("user_id", userId)
      .gte("elo_rating", myEntry.elo_rating - eloRange)
      .lte("elo_rating", myEntry.elo_rating + eloRange)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!opponent) {
      return NextResponse.json({ status: "waiting", eloRange, waitMs });
    }

    // Found a match — atomically update opponent to prevent double-matching
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from("arena_queue")
      .update({ status: "matched" })
      .eq("id", opponent.id)
      .eq("status", "waiting")
      .select()
      .single();

    if (lockErr || !locked) {
      // Opponent was grabbed by someone else
      return NextResponse.json({ status: "waiting", eloRange, waitMs });
    }

    // Select 10 questions for the match
    const questionIds = await selectArenaQuestions();
    if (questionIds.length < 5) {
      // Not enough questions — revert
      await supabaseAdmin.from("arena_queue").update({ status: "waiting" }).eq("id", opponent.id);
      return NextResponse.json({ status: "waiting", eloRange, waitMs, note: "Not enough questions in database" });
    }

    // Get ELO ratings
    const [{ data: p1Profile }, { data: p2Profile }] = await Promise.all([
      supabaseAdmin.from("profiles").select("arena_elo").eq("id", userId).single(),
      supabaseAdmin.from("profiles").select("arena_elo").eq("id", opponent.user_id).single(),
    ]);

    // Create the match
    const { data: match, error: matchErr } = await supabaseAdmin
      .from("arena_matches")
      .insert({
        player1_id: userId,
        player2_id: opponent.user_id,
        question_ids: questionIds,
        wager: myEntry.wager,
        status: "pending",
        player1_elo_before: p1Profile?.arena_elo ?? 1000,
        player2_elo_before: p2Profile?.arena_elo ?? 1000,
      })
      .select()
      .single();

    if (matchErr || !match) {
      await supabaseAdmin.from("arena_queue").update({ status: "waiting" }).eq("id", opponent.id);
      return NextResponse.json({ error: "Failed to create match" }, { status: 500 });
    }

    // Run judge on all questions in parallel
    await judgeQuestions(match.id, questionIds);

    // Update both queue entries with match_id
    await Promise.all([
      supabaseAdmin.from("arena_queue").update({ status: "matched", match_id: match.id }).eq("id", myEntry.id),
      supabaseAdmin.from("arena_queue").update({ match_id: match.id }).eq("id", locked.id),
    ]);

    return NextResponse.json({ status: "matched", matchId: match.id });
  } catch (e) {
    console.error("[arena/queue GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE — Leave the queue
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    await supabaseAdmin
      .from("arena_queue")
      .update({ status: "cancelled" })
      .eq("user_id", userId)
      .eq("status", "waiting");

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────

const ARENA_TOPICS = ["algebra", "biology", "chemistry", "physics", "earth-science", "astronomy"];

async function selectArenaQuestions(): Promise<string[]> {
  // Fetch questions from arena-eligible topics across all difficulties
  const { data: allQuestions } = await supabaseAdmin
    .from("questions")
    .select("id, difficulty, topic")
    .in("topic", ARENA_TOPICS)
    .limit(200);

  if (!allQuestions || allQuestions.length === 0) {
    // Fallback: try by subject
    const { data: fallback } = await supabaseAdmin
      .from("questions")
      .select("id, difficulty")
      .in("subject", ["Math", "Science"])
      .limit(200);

    if (!fallback || fallback.length === 0) return [];
    return fallback.sort(() => Math.random() - 0.5).slice(0, 10).map(q => q.id);
  }

  // Bucket by difficulty
  const beginner = allQuestions.filter(q => q.difficulty === "beginner");
  const intermediate = allQuestions.filter(q => q.difficulty === "intermediate");
  const advanced = allQuestions.filter(q => q.difficulty === "advanced");

  // Weighted selection: 3 beginner, 5 intermediate, 2 advanced
  const shuffle = <T,>(arr: T[]) => arr.sort(() => Math.random() - 0.5);
  const picked = [
    ...shuffle(beginner).slice(0, 3),
    ...shuffle(intermediate).slice(0, 5),
    ...shuffle(advanced).slice(0, 2),
  ];

  // If not enough in a bucket, fill from others
  if (picked.length < 10) {
    const pickedIds = new Set(picked.map(q => q.id));
    const remaining = shuffle(allQuestions.filter(q => !pickedIds.has(q.id)));
    picked.push(...remaining.slice(0, 10 - picked.length));
  }

  return shuffle(picked).slice(0, 10).map(q => q.id);
}

async function judgeQuestions(matchId: string, questionIds: string[]) {
  // Fetch question texts
  const { data: questions } = await supabaseAdmin
    .from("questions")
    .select("id, question, difficulty")
    .in("id", questionIds);

  if (!questions) return;

  // Order questions to match questionIds order
  const ordered = questionIds.map(id => questions.find(q => q.id === id)).filter(Boolean);

  // Try Claude API judge, fall back to heuristic
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const judgeResults = await Promise.all(
    ordered.map(async (q, idx) => {
      let timeLimit = 15;
      let cognitiveLoad = "recall";

      if (apiKey && q) {
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 100,
              messages: [{
                role: "user",
                content: `You are a Judge for a competitive quiz app. Analyze this question and return ONLY a JSON object with two fields: time_limit (integer, seconds between 8-25 that a knowledgeable student would need), and cognitive_load (string: 'recall', 'calculation', or 'reasoning'). Question: ${q.question}`,
              }],
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const text = data.content?.[0]?.text ?? "";
            const match = text.match(/\{[\s\S]*?\}/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              timeLimit = Math.max(8, Math.min(25, parsed.time_limit ?? 15));
              cognitiveLoad = ["recall", "calculation", "reasoning"].includes(parsed.cognitive_load)
                ? parsed.cognitive_load : "recall";
            }
          }
        } catch {
          // Fall through to heuristic
        }
      }

      // Heuristic fallback
      if (!apiKey || timeLimit === 15) {
        if (q) {
          const len = q.question.length;
          const text = q.question.toLowerCase();
          if (text.includes("calculate") || text.includes("solve") || text.includes("compute")) {
            cognitiveLoad = "calculation";
            timeLimit = len > 150 ? 22 : 18;
          } else if (text.includes("why") || text.includes("explain") || text.includes("which of")) {
            cognitiveLoad = "reasoning";
            timeLimit = len > 150 ? 20 : 15;
          } else {
            cognitiveLoad = "recall";
            timeLimit = len > 200 ? 15 : len > 100 ? 12 : 10;
          }
          // Adjust for difficulty
          if (q.difficulty === "advanced") timeLimit = Math.min(25, timeLimit + 4);
          else if (q.difficulty === "beginner") timeLimit = Math.max(8, timeLimit - 2);
        }
      }

      return { questionId: q?.id, order: idx, timeLimit, cognitiveLoad };
    })
  );

  // Insert judge results
  const rows = judgeResults.filter(r => r.questionId).map(r => ({
    match_id: matchId,
    question_id: r.questionId!,
    question_order: r.order,
    time_limit: r.timeLimit,
    cognitive_load: r.cognitiveLoad,
  }));

  if (rows.length > 0) {
    await supabaseAdmin.from("arena_match_questions").insert(rows);
  }
}
