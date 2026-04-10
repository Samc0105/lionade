import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { calcNinnyReward, type NinnyMode } from "@/lib/ninny";

export const dynamic = "force-dynamic";

interface WrongAnswer {
  question: string;
  correctAnswer: string;
}

interface CompleteRequest {
  materialId: string;
  mode: NinnyMode;
  score: number;
  total: number;
  wrongAnswers?: WrongAnswer[];
}

const VALID_MODES: NinnyMode[] = [
  "flashcards",
  "match",
  "mcq",
  "fill",
  "tf",
  "ordering",
  "blitz",
];

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Auth: derive userId from session, NEVER trust the body
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: CompleteRequest;
  try {
    body = (await req.json()) as CompleteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { materialId, mode } = body;
  const wrongAnswers = body.wrongAnswers ?? [];

  if (!materialId || !mode) {
    return NextResponse.json(
      { error: "Missing materialId or mode" },
      { status: 400 },
    );
  }

  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  // Look up material first — needed to verify ownership AND clamp score/total
  const { data: material, error: matErr } = await supabaseAdmin
    .from("ninny_materials")
    .select("id, user_id, generated_content")
    .eq("id", materialId)
    .single();

  if (matErr || !material || material.user_id !== userId) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  // Clamp score/total against the material's actual question count to prevent
  // self-grant exploits via inflated body values
  const modeKeyMap: Record<NinnyMode, keyof typeof material.generated_content> = {
    flashcards: "flashcards",
    match: "match",
    mcq: "multipleChoice",
    fill: "fillBlank",
    tf: "trueFalse",
    ordering: "ordering",
    blitz: "blitz",
  };
  const arr = material.generated_content?.[modeKeyMap[mode]];
  const realTotal = Array.isArray(arr) ? arr.length : 0;
  const total = Math.max(1, Math.min(realTotal || 100, Number(body.total) || 0));
  const score = Math.max(0, Math.min(total, Number(body.score) || 0));

  // 40% floor + 60% accuracy bonus, min 5 each — protects against shutout
  const { coins: coinsEarned, xp: xpEarned } = calcNinnyReward(mode, score, total);

  // 1. Insert session
  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("ninny_sessions")
    .insert({
      user_id: userId,
      material_id: materialId,
      mode,
      score,
      total,
      coins_earned: coinsEarned,
      xp_earned: xpEarned,
    })
    .select("id")
    .single();

  if (sessionErr) {
    console.error("[ninny/complete] session insert:", sessionErr.message);
    return NextResponse.json({ error: "Failed to save session" }, { status: 500 });
  }

  // 2. Fetch profile (need streak fields too)
  const { data: profile, error: profileFetchErr } = await supabaseAdmin
    .from("profiles")
    .select(
      "coins, xp, streak, max_streak, last_activity_at, daily_questions_completed, daily_reset_date",
    )
    .eq("id", userId)
    .single();

  if (profileFetchErr) {
    console.error("[ninny/complete] profile fetch:", profileFetchErr.message);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }

  const newCoins = (profile.coins ?? 0) + coinsEarned;
  const newXp = (profile.xp ?? 0) + xpEarned;

  // 3. Daily activity + streak (mirrors save-quiz-results step 5)
  const nowISO = new Date().toISOString();
  const todayUTC = nowISO.split("T")[0];

  const { data: existingDaily } = await supabaseAdmin
    .from("daily_activity")
    .select("id, questions_answered, coins_earned")
    .eq("user_id", userId)
    .eq("date", todayUTC)
    .maybeSingle();

  if (existingDaily) {
    await supabaseAdmin
      .from("daily_activity")
      .update({
        questions_answered: existingDaily.questions_answered + total,
        coins_earned: existingDaily.coins_earned + coinsEarned,
        streak_maintained: true,
      })
      .eq("id", existingDaily.id);
  } else {
    await supabaseAdmin.from("daily_activity").insert({
      user_id: userId,
      date: todayUTC,
      questions_answered: total,
      coins_earned: coinsEarned,
      streak_maintained: true,
    });
  }

  // Daily questions counter (capped at 10) + streak math
  let dailyQuestionsCompleted = profile.daily_questions_completed ?? 0;
  if (profile.daily_reset_date !== todayUTC) {
    dailyQuestionsCompleted = 0;
  }
  dailyQuestionsCompleted = Math.min(
    Math.min(dailyQuestionsCompleted, 10) + total,
    10,
  );

  let newStreak = profile.streak ?? 0;
  const lastActivityAt = profile.last_activity_at as string | null;

  if (lastActivityAt) {
    const lastDayUTC = new Date(lastActivityAt).toISOString().split("T")[0];
    if (lastDayUTC !== todayUTC) {
      const daysDiff = Math.floor(
        (new Date(todayUTC + "T00:00:00Z").getTime() -
          new Date(lastDayUTC + "T00:00:00Z").getTime()) /
          (1000 * 60 * 60 * 24),
      );
      if (daysDiff === 1) {
        newStreak = (profile.streak ?? 0) + 1;
      } else {
        newStreak = 1;
      }
    }
  } else if ((profile.streak ?? 0) === 0) {
    newStreak = 1;
  }

  const newMaxStreak = Math.max(newStreak, profile.max_streak ?? 0);

  const { error: profileUpdateErr } = await supabaseAdmin
    .from("profiles")
    .update({
      coins: newCoins,
      xp: newXp,
      streak: newStreak,
      max_streak: newMaxStreak,
      last_activity_at: nowISO,
      daily_questions_completed: dailyQuestionsCompleted,
      daily_reset_date: todayUTC,
    })
    .eq("id", userId);

  if (profileUpdateErr) {
    console.error("[ninny/complete] profile update:", profileUpdateErr.message);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }

  // 4. Log coin transaction
  if (coinsEarned > 0) {
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: coinsEarned,
      type: "ninny_session",
      reference_id: String(session.id),
      description: `Ninny ${mode}: ${score}/${total}`,
    });
  }

  // 5. Save wrong answers (upsert with miss_count increment)
  if (wrongAnswers.length > 0) {
    for (const wa of wrongAnswers) {
      if (!wa.question || !wa.correctAnswer) continue;
      const { data: existing } = await supabaseAdmin
        .from("ninny_wrong_answers")
        .select("id, miss_count")
        .eq("user_id", userId)
        .eq("material_id", materialId)
        .eq("question_text", wa.question)
        .maybeSingle();

      if (existing) {
        await supabaseAdmin
          .from("ninny_wrong_answers")
          .update({
            miss_count: existing.miss_count + 1,
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("ninny_wrong_answers").insert({
          user_id: userId,
          material_id: materialId,
          question_text: wa.question,
          correct_answer: wa.correctAnswer,
          miss_count: 1,
        });
      }
    }
  }

  return NextResponse.json({
    success: true,
    sessionId: session.id,
    coinsEarned,
    xpEarned,
    newCoins,
    newXp,
  });
}
